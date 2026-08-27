use serde::Serialize;
use std::env;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;
use tokio::time::{Duration, timeout};

const MESSAGE_EVENT: &str = "syndrid://app-server/message";
const STDERR_EVENT: &str = "syndrid://app-server/stderr";
const APP_SERVER_STOP_GRACE: Duration = Duration::from_millis(750);
const MAX_FORWARDED_LINE_BYTES: usize = 32 * 1024 * 1024;
const FORWARD_READ_BUFFER_BYTES: usize = 16 * 1024;
const MAX_RUNTIME_BINARY_CHARS: usize = 32_768;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
struct AppServerInner {
    process: Option<Child>,
    stdin: Option<ChildStdin>,
    binary: Option<String>,
}

#[derive(Clone, Default)]
struct AppServerState(Arc<Mutex<AppServerInner>>);

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
enum AppServerStatus {
    Stopped,
    Running { pid: u32, binary: String },
    Exited { code: Option<i32> },
}

#[tauri::command]
async fn start_app_server(
    app: AppHandle,
    state: State<'_, AppServerState>,
    binary: Option<String>,
) -> Result<AppServerStatus, String> {
    let mut inner = state.0.lock().await;

    let active_binary = inner
        .binary
        .clone()
        .unwrap_or_else(|| "syndrid".to_string());
    if let Some(child) = inner.process.as_mut() {
        match child.try_wait().map_err(|error| error.to_string())? {
            None => {
                let pid = child.id().unwrap_or_default();
                return Ok(AppServerStatus::Running {
                    pid,
                    binary: active_binary,
                });
            }
            Some(status) => {
                inner.process = None;
                inner.stdin = None;
                inner.binary = None;
                let _ = app.emit(
                    STDERR_EVENT,
                    format!("previous app-server exited with status {:?}", status.code()),
                );
            }
        }
    }

    let candidates = runtime_candidates(binary);
    let mut errors = Vec::new();

    for candidate in candidates {
        let mut command = Command::new(&candidate);
        command
            .arg("app-server")
            .arg("--listen")
            .arg("stdio://")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        match command.spawn() {
            Ok(mut child) => {
                let pid = child.id().unwrap_or_default();
                let stdin = child
                    .stdin
                    .take()
                    .ok_or_else(|| "app-server stdin unavailable".to_string())?;
                let stdout = child
                    .stdout
                    .take()
                    .ok_or_else(|| "app-server stdout unavailable".to_string())?;
                let stderr = child
                    .stderr
                    .take()
                    .ok_or_else(|| "app-server stderr unavailable".to_string())?;

                spawn_line_forwarder(app.clone(), stdout, MESSAGE_EVENT);
                spawn_line_forwarder(app.clone(), stderr, STDERR_EVENT);

                inner.stdin = Some(stdin);
                inner.process = Some(child);
                inner.binary = Some(candidate.clone());

                return Ok(AppServerStatus::Running {
                    pid,
                    binary: candidate,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                errors.push(format!("{candidate}: not found"));
            }
            Err(error) => {
                errors.push(format!("{candidate}: {error}"));
            }
        }
    }

    Err(format!(
        "Unable to start the Syndrid app-server. Tried: {}. Set SYNDRID_APP_SERVER_BINARY or configure an explicit Syndrid binary.",
        errors.join(", ")
    ))
}

#[tauri::command]
async fn app_server_send(state: State<'_, AppServerState>, line: String) -> Result<(), String> {
    let mut inner = state.0.lock().await;
    let stdin = inner
        .stdin
        .as_mut()
        .ok_or_else(|| "Syndrid app-server is not running.".to_string())?;

    stdin
        .write_all(line.trim_end_matches(&['\r', '\n'][..]).as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stdin
        .write_all(b"\n")
        .await
        .map_err(|error| error.to_string())?;
    stdin.flush().await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn app_server_status(state: State<'_, AppServerState>) -> Result<AppServerStatus, String> {
    let mut inner = state.0.lock().await;
    let active_binary = inner
        .binary
        .clone()
        .unwrap_or_else(|| "syndrid".to_string());
    let Some(child) = inner.process.as_mut() else {
        return Ok(AppServerStatus::Stopped);
    };

    match child.try_wait().map_err(|error| error.to_string())? {
        None => Ok(AppServerStatus::Running {
            pid: child.id().unwrap_or_default(),
            binary: active_binary,
        }),
        Some(status) => {
            inner.process = None;
            inner.stdin = None;
            inner.binary = None;
            Ok(AppServerStatus::Exited {
                code: status.code(),
            })
        }
    }
}

#[tauri::command]
async fn stop_app_server(state: State<'_, AppServerState>) -> Result<(), String> {
    let mut inner = state.0.lock().await;
    // Closing stdin first gives the stdio app-server a bounded opportunity to
    // observe EOF and perform its own cleanup before Desktop force-terminates it.
    inner.stdin = None;
    let process = inner.process.take();
    inner.binary = None;
    drop(inner);

    if let Some(child) = process {
        terminate_child(child).await?;
    }
    Ok(())
}

async fn terminate_child(mut child: Child) -> Result<(), String> {
    match timeout(APP_SERVER_STOP_GRACE, child.wait()).await {
        Ok(result) => {
            result.map_err(|error| error.to_string())?;
            Ok(())
        }
        Err(_) => {
            child.kill().await.map_err(|error| error.to_string())?;
            child.wait().await.map_err(|error| error.to_string())?;
            Ok(())
        }
    }
}

fn normalize_runtime_binary(value: String) -> Option<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return None;
    }

    let normalized = normalized
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .map(str::trim)
        .unwrap_or(normalized);
    if normalized.is_empty()
        || normalized.contains('\0')
        || normalized.len() > MAX_RUNTIME_BINARY_CHARS.saturating_mul(4)
        || normalized.chars().count() > MAX_RUNTIME_BINARY_CHARS
    {
        return None;
    }
    Some(normalized.to_string())
}

fn runtime_candidates(explicit: Option<String>) -> Vec<String> {
    if let Some(binary) = explicit.and_then(normalize_runtime_binary) {
        return vec![binary];
    }

    let mut candidates = Vec::new();
    if let Ok(binary) = env::var("SYNDRID_APP_SERVER_BINARY")
        && let Some(binary) = normalize_runtime_binary(binary)
    {
        candidates.push(binary);
    }
    candidates.push("syndrid".to_string());
    candidates.dedup();
    candidates
}

fn spawn_line_forwarder<R>(app: AppHandle, mut reader: R, event: &'static str)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut read_buffer = [0_u8; FORWARD_READ_BUFFER_BYTES];
        let mut line = Vec::with_capacity(FORWARD_READ_BUFFER_BYTES);
        let mut dropping_overlong_line = false;

        loop {
            let bytes_read = match reader.read(&mut read_buffer).await {
                Ok(0) => {
                    if dropping_overlong_line {
                        emit_overlong_line_warning(&app, event);
                    } else if !line.is_empty() {
                        emit_forwarded_line(&app, event, &line);
                    }
                    break;
                }
                Ok(bytes_read) => bytes_read,
                Err(error) => {
                    let _ = app.emit(STDERR_EVENT, format!("stream read error: {error}"));
                    break;
                }
            };

            for &byte in &read_buffer[..bytes_read] {
                if byte == b'\n' {
                    if dropping_overlong_line {
                        emit_overlong_line_warning(&app, event);
                    } else {
                        emit_forwarded_line(&app, event, &line);
                    }
                    line.clear();
                    dropping_overlong_line = false;
                    continue;
                }

                if dropping_overlong_line {
                    continue;
                }

                if line.len() >= MAX_FORWARDED_LINE_BYTES {
                    line.clear();
                    dropping_overlong_line = true;
                    continue;
                }
                line.push(byte);
            }
        }
    });
}

fn emit_forwarded_line(app: &AppHandle, event: &'static str, bytes: &[u8]) {
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(line) => {
            let _ = app.emit(event, line);
        }
        Err(error) => {
            let _ = app.emit(STDERR_EVENT, format!("stream UTF-8 error: {error}"));
        }
    }
}

fn emit_overlong_line_warning(app: &AppHandle, event: &'static str) {
    let _ = app.emit(
        STDERR_EVENT,
        format!(
            "dropped overlong {event} line exceeding {} MiB",
            MAX_FORWARDED_LINE_BYTES / (1024 * 1024)
        ),
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppServerState::default())
        .invoke_handler(tauri::generate_handler![
            start_app_server,
            app_server_send,
            app_server_status,
            stop_app_server
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<AppServerState>();
                let state = state.inner().clone();
                tauri::async_runtime::spawn(async move {
                    let mut inner = state.0.lock().await;
                    inner.stdin = None;
                    let process = inner.process.take();
                    inner.binary = None;
                    drop(inner);
                    if let Some(child) = process {
                        let _ = terminate_child(child).await;
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Syndrid Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_explicit_runtime_binary() {
        assert_eq!(
            runtime_candidates(Some(
                "  C:\\Program Files\\Syndrid\\syndrid.exe  ".to_string()
            )),
            vec!["C:\\Program Files\\Syndrid\\syndrid.exe".to_string()]
        );
    }

    #[test]
    fn normalizes_quoted_runtime_binary() {
        assert_eq!(
            runtime_candidates(Some(
                "  \"C:\\Program Files\\Syndrid\\syndrid.exe\"  ".to_string()
            )),
            vec!["C:\\Program Files\\Syndrid\\syndrid.exe".to_string()]
        );
        assert_eq!(
            runtime_candidates(Some(
                "\" /Applications/Syndrid CLI/bin/syndrid \"".to_string()
            )),
            vec!["/Applications/Syndrid CLI/bin/syndrid".to_string()]
        );
    }

    #[test]
    fn ignores_blank_explicit_runtime_binary() {
        let candidates = runtime_candidates(Some("  \t  ".to_string()));
        assert!(candidates.iter().any(|candidate| candidate == "syndrid"));
        assert!(
            candidates
                .iter()
                .all(|candidate| !candidate.trim().is_empty())
        );
    }

    #[test]
    fn rejects_invalid_explicit_runtime_binary() {
        for invalid in [
            format!("{}x", "x".repeat(MAX_RUNTIME_BINARY_CHARS)),
            "bad\0path".to_string(),
        ] {
            let candidates = runtime_candidates(Some(invalid));
            assert_eq!(candidates, vec!["syndrid".to_string()]);
        }
    }
}
