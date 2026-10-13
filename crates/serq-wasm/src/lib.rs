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

/// The program's IR as JSON (`serq ir`).
#[wasm_bindgen]
pub fn ir(src: &str) -> Result<String, JsError> {
    serq::compile_source(src, &overrides(None, None))
        .map(|p| p.to_json())
        .map_err(|e| JsError::new(&e))
}

/// The deployment view as SVG (`serq draw`).
#[wasm_bindgen]
pub fn draw(src: &str) -> Result<String, JsError> {
    let p = serq::compile_source(src, &overrides(Some(1.0), None)).map_err(|e| JsError::new(&e))?;
    let figure = serq::view::deployment::figure(&p);
    serq::view::render(&figure, "svg").map_err(|e| JsError::new(&e))
}

/// The program's stage names, each once, in the IR's order: an array's
/// stages share one name (`P`, drawn `P[i]`). A horizon is supplied, as
/// `serq draw` does: the names do not depend on it.
#[wasm_bindgen]
pub fn stages(src: &str) -> Result<String, JsError> {
    let p = serq::compile_source(src, &overrides(Some(1.0), None)).map_err(|e| JsError::new(&e))?;
    let mut names: Vec<&str> = vec![];
    for s in &p.stages {
        if !names.contains(&s.name.as_str()) {
            names.push(&s.name);
        }
    }
    serde_json::to_string(&names).map_err(|e| JsError::new(&e.to_string()))
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
