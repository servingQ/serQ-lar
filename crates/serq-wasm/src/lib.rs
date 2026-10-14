//! serQ in the browser: compile, draw and run a program's text, with no
//! server. Each entry point takes the program text and returns a string
//! (IR JSON, SVG, report JSON) or throws the diagnostic serQ would print.
//! With a `workload` text, the program is a deployment file the tool pairs
//! with that workload file (serQ `--workload`, `compile_paired`): serQ's
//! messages then name the file, `deployment: 3:5: …` or `workload: …`.

use wasm_bindgen::prelude::*;

/// How serQ names the two files of a pair in a message.
const NAMES: (&str, &str) = ("deployment", "workload");

/// The program: the text alone, or the deployment paired with a workload.
fn compile(
    src: &str,
    workload: Option<&str>,
    ov: &serq::Overrides,
    inspected: bool,
) -> Result<serq::Program, JsError> {
    match (workload, inspected) {
        (Some(w), true) => serq::compile_paired_inspected(src, w, NAMES, ov),
        (Some(w), false) => serq::compile_paired(src, w, NAMES, ov),
        (None, true) => serq::compile_inspected(src, ov),
        (None, false) => serq::compile_source(src, ov),
    }
    .map_err(|e| JsError::new(&e))
}

fn overrides(horizon: Option<f64>, seed: Option<u64>) -> serq::Overrides {
    serq::Overrides {
        horizon,
        seed,
        ..Default::default()
    }
}

/// The serQ this module was built from.
#[wasm_bindgen]
pub fn version() -> String {
    serq::VERSION.into()
}

/// The program's IR as JSON (`serq ir`), compiled for inspection: a
/// program without a horizon gets a placeholder one, as `serq draw` does.
#[wasm_bindgen]
pub fn ir(src: &str, workload: Option<String>) -> Result<String, JsError> {
    compile(src, workload.as_deref(), &overrides(None, None), true).map(|p| p.to_json())
}

/// The deployment view as SVG (`serq draw`), refused as `serq draw` refuses
/// it when a station would have no arrow in or no arrow out (serQ #626).
#[wasm_bindgen]
pub fn draw(src: &str, workload: Option<String>) -> Result<String, JsError> {
    let p = compile(src, workload.as_deref(), &overrides(None, None), true)?;
    let figure = serq::view::deployment::checked_figure(&p).map_err(|e| JsError::new(&e))?;
    serq::view::render(&figure, "svg").map_err(|e| JsError::new(&e))
}

/// Run the program and return the report as JSON (`serq run --json`).
/// A program that names a trace file cannot run here: there is no file
/// system.
#[wasm_bindgen]
pub fn run(
    src: &str,
    workload: Option<String>,
    horizon: Option<f64>,
    seed: Option<u64>,
) -> Result<String, JsError> {
    let p = compile(src, workload.as_deref(), &overrides(horizon, seed), false)?;
    serq::run_ir(&p, None)
        .map(|r| r.json())
        .map_err(|e| JsError::new(&e))
}

/// `run`, keeping the log of the run (`serq run --log`): the report's JSON
/// with `log`, at most `cap` events (serQ's `docs/reference/log.md`), and
/// with `series`, the samples and change points the JSON leaves out.
#[wasm_bindgen]
pub fn run_logged(
    src: &str,
    workload: Option<String>,
    horizon: Option<f64>,
    seed: Option<u64>,
    cap: usize,
) -> Result<String, JsError> {
    let p = compile(src, workload.as_deref(), &overrides(horizon, seed), false)?;
    let r = serq::run_ir_logged(&p, None, cap).map_err(|e| JsError::new(&e))?;
    let mut json = r.json();
    // the report's JSON ends with `}`: open it and add the series
    json.pop();
    json.push_str(",\"series\":");
    json.push_str(&series(&r));
    json.push('}');
    Ok(json)
}

/// What `serq run --dump` writes and `--json` does not: every sample of
/// each client metric and `observe` with its time, session and turn, and
/// each gauge's change points, as columns (serQ's `Report`; the page's
/// `web/src/series.ts` mirrors the shape).
fn series(r: &serq::Report) -> String {
    use serde_json::{Map, Value, json};
    fn observes(list: &[serq::engine::report::ObserveReport]) -> Value {
        let mut m = Map::new();
        for o in list {
            m.insert(
                o.name.clone(),
                json!({
                    "t": o.records.iter().map(|r| r.0).collect::<Vec<_>>(),
                    "v": o.samples,
                    "s": o.records.iter().map(|r| r.1).collect::<Vec<_>>(),
                    "turn": o.records.iter().map(|r| r.2).collect::<Vec<_>>(),
                }),
            );
        }
        Value::Object(m)
    }
    let mut gauges = Map::new();
    for g in &r.gauges {
        gauges.insert(
            g.name.clone(),
            json!({
                "t": g.points.iter().map(|p| p.0).collect::<Vec<_>>(),
                "v": g.points.iter().map(|p| p.1).collect::<Vec<_>>(),
            }),
        );
    }
    json!({
        "version": 0,
        "client": observes(&r.client),
        "observes": observes(&r.observes),
        "gauges": Value::Object(gauges),
    })
    .to_string()
}

/// The program cut into pieces with their roles, for colouring
/// (`serq::frontend::highlight`): a JSON array of `[role, text]` whose
/// texts, concatenated, are the source. Past a lexical error, the rest is
/// one `unlexed` piece.
#[wasm_bindgen]
pub fn tokens(src: &str) -> String {
    let pieces: Vec<_> = serq::frontend::highlight::highlight(src)
        .into_iter()
        .map(|(role, text)| serde_json::json!([role.name(), text]))
        .collect();
    serde_json::Value::Array(pieces).to_string()
}

/// Where each declaration, relation and entry call is written in the text,
/// as JSON (`serq::outline`): what the page changes when the figure is
/// edited. Parse only, so text that does not link still has one. Paired,
/// it is the deployment's (`serq::outline_paired`): the figure edits the
/// deployment.
#[wasm_bindgen]
pub fn outline(src: &str, workload: Option<String>) -> Result<String, JsError> {
    match workload {
        Some(w) => serq::outline_paired(src, &w).map(|(d, _)| d.to_json()),
        None => serq::outline(src).map(|o| o.to_json()),
    }
    .map_err(|e| JsError::new(&e))
}

/// Every word the language gives a program, with the role it is coloured
/// by, for completing them (`serq::frontend::highlight::vocabulary`): a
/// JSON array of `[role, word]`.
#[wasm_bindgen]
pub fn vocabulary() -> String {
    let words: Vec<_> = serq::frontend::highlight::vocabulary()
        .into_iter()
        .map(|(role, word)| serde_json::json!([role.name(), word]))
        .collect();
    serde_json::Value::Array(words).to_string()
}
