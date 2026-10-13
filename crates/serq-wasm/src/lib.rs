//! serQ in the browser: compile, draw and run a program's text, with no
//! server. Each entry point takes the program text and returns a string
//! (IR JSON, SVG, report JSON) or throws the diagnostic serQ would print.

use wasm_bindgen::prelude::*;

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
pub fn ir(src: &str) -> Result<String, JsError> {
    serq::compile_inspected(src, &overrides(None, None))
        .map(|p| p.to_json())
        .map_err(|e| JsError::new(&e))
}

/// The deployment view as SVG (`serq draw`).
#[wasm_bindgen]
pub fn draw(src: &str) -> Result<String, JsError> {
    let p = serq::compile_inspected(src, &overrides(None, None)).map_err(|e| JsError::new(&e))?;
    let figure = serq::view::deployment::figure(&p);
    serq::view::render(&figure, "svg").map_err(|e| JsError::new(&e))
}

/// Run the program and return the report as JSON (`serq run --json`).
/// A program that names a trace file cannot run here: there is no file
/// system.
#[wasm_bindgen]
pub fn run(src: &str, horizon: Option<f64>, seed: Option<u64>) -> Result<String, JsError> {
    serq::run_source(src, &overrides(horizon, seed), None)
        .map(|r| r.json())
        .map_err(|e| JsError::new(&e))
}

/// `run`, keeping the log of the run (`serq run --log`): the report's JSON
/// with `log`, at most `cap` events (serQ's `docs/reference/log.md`).
#[wasm_bindgen]
pub fn run_logged(
    src: &str,
    horizon: Option<f64>,
    seed: Option<u64>,
    cap: usize,
) -> Result<String, JsError> {
    let p = serq::compile_source(src, &overrides(horizon, seed)).map_err(|e| JsError::new(&e))?;
    serq::run_ir_logged(&p, None, cap)
        .map(|r| r.json())
        .map_err(|e| JsError::new(&e))
}
