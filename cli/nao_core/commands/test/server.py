import http.server
import json
import socketserver
import webbrowser
from functools import partial
from pathlib import Path
from typing import Annotated

from cyclopts import Parameter

from nao_core.config import NaoConfig
from nao_core.ui import UI

from .case import TESTS_FOLDER

# Default port for the server
DEFAULT_PORT = 8765


def get_html_template() -> str:
    """Return the HTML template for the test results viewer."""
    return """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>nao Test Results</title>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f0f; color: #e5e5e5; line-height: 1.5; }
        .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid #333; }
        h1 { font-size: 1.5rem; font-weight: 600; color: #fff; }
        h1 span { color: #888; font-weight: 400; }
        .file-select { display: flex; align-items: center; gap: 0.75rem; }
        .file-select label { color: #888; font-size: 0.875rem; }
        select { background: #1a1a1a; border: 1px solid #333; color: #e5e5e5; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.875rem; cursor: pointer; }
        select:hover { border-color: #555; }
        .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .card { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 1.25rem; }
        .card-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
        .card-value { font-size: 1.75rem; font-weight: 600; color: #fff; }
        .card-value.success { color: #22c55e; }
        .card-value.error { color: #ef4444; }
        table { width: 100%; border-collapse: collapse; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
        th, td { padding: 0.875rem 1rem; text-align: left; border-bottom: 1px solid #333; }
        th { background: #252525; font-weight: 500; font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: #252525; }
        tr.clickable { cursor: pointer; }
        .status { display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.25rem 0.625rem; border-radius: 4px; font-size: 0.75rem; font-weight: 500; }
        .status.pass { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
        .status.fail { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
        .model-badge { display: inline-block; padding: 0.125rem 0.5rem; background: #333; border-radius: 4px; font-size: 0.75rem; color: #aaa; font-family: monospace; }
        .mono { font-family: monospace; font-size: 0.875rem; }
        .text-muted { color: #888; }
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.8); z-index: 1000; display: flex; align-items: center; justify-content: center; }
        .modal { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; width: 90%; max-width: 900px; max-height: 85vh; overflow: hidden; display: flex; flex-direction: column; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 1.5rem; border-bottom: 1px solid #333; }
        .modal-header h2 { font-size: 1.125rem; font-weight: 600; }
        .modal-close { background: none; border: none; color: #888; font-size: 1.5rem; cursor: pointer; padding: 0.25rem; line-height: 1; }
        .modal-close:hover { color: #fff; }
        .modal-body { padding: 1.5rem; overflow-y: auto; }
        .detail-section { margin-bottom: 1.5rem; }
        .detail-section:last-child { margin-bottom: 0; }
        .detail-section h3 { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
        .detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; }
        .detail-item { background: #252525; padding: 0.75rem; border-radius: 6px; }
        .detail-item .label { font-size: 0.75rem; color: #888; margin-bottom: 0.25rem; }
        .detail-item .value { font-weight: 500; }
        pre { background: #0f0f0f; border: 1px solid #333; border-radius: 6px; padding: 1rem; overflow-x: auto; font-family: monospace; font-size: 0.8125rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
        .data-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
        .data-table th, .data-table td { padding: 0.5rem 0.75rem; border: 1px solid #333; text-align: left; }
        .data-table th { background: #252525; font-weight: 500; }
        .tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
        .tab { padding: 0.5rem 1rem; background: #252525; border: 1px solid #333; border-radius: 6px; color: #888; cursor: pointer; font-size: 0.875rem; }
        .tab.active { background: #333; color: #fff; border-color: #555; }
        .empty-state { text-align: center; padding: 4rem 2rem; color: #888; }
        .empty-state h2 { font-size: 1.125rem; margin-bottom: 0.5rem; color: #aaa; }
        .tool-calls-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .tool-call { background: #252525; border: 1px solid #333; border-radius: 6px; overflow: hidden; }
        .tool-call-header { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; cursor: pointer; }
        .tool-call-header:hover { background: #2a2a2a; }
        .tool-call-index { background: #333; color: #888; padding: 0.125rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-family: monospace; }
        .tool-call-name { font-weight: 500; color: #4ade80; font-family: monospace; }
        .tool-call-expand { margin-left: auto; color: #666; font-size: 0.75rem; }
        .tool-call-details { border-top: 1px solid #333; padding: 1rem; }
        .tool-call-section { margin-bottom: 1rem; }
        .tool-call-section:last-child { margin-bottom: 0; }
        .tool-call-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
        .tool-call-details pre { margin: 0; max-height: 300px; overflow: auto; }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="text/babel">
        const { useState, useEffect } = React;

        function App() {
            const [files, setFiles] = useState([]);
            const [selectedFile, setSelectedFile] = useState('');
            const [data, setData] = useState(null);
            const [selectedResult, setSelectedResult] = useState(null);
            const [activeTab, setActiveTab] = useState('actual');

            useEffect(() => {
                fetch('/api/files')
                    .then(r => r.json())
                    .then(files => {
                        setFiles(files);
                        if (files.length > 0) {
                            setSelectedFile(files[0]);
                        }
                    })
                    .catch(console.error);
            }, []);

            useEffect(() => {
                if (selectedFile) {
                    fetch('/api/results/' + encodeURIComponent(selectedFile))
                        .then(r => r.json())
                        .then(setData)
                        .catch(console.error);
                }
            }, [selectedFile]);

            return (
                <div className="container">
                    <header>
                        <h1>nao <span>Test Results</span></h1>
                        <div className="file-select">
                            <label>Result file:</label>
                            <select value={selectedFile} onChange={e => setSelectedFile(e.target.value)}>
                                <option value="">Select a file...</option>
                                {files.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </div>
                    </header>

                    {!data ? (
                        <div className="empty-state">
                            <h2>No results loaded</h2>
                            <p>Select a result file from the dropdown above to view test results.</p>
                        </div>
                    ) : (
                        <Results data={data} onSelect={setSelectedResult} />
                    )}

                    {selectedResult && (
                        <Modal
                            result={selectedResult}
                            activeTab={activeTab}
                            setActiveTab={setActiveTab}
                            onClose={() => setSelectedResult(null)}
                        />
                    )}
                </div>
            );
        }

        function Results({ data, onSelect }) {
            const { summary, results, timestamp } = data;
            const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

            return (
                <>
                    <div className="summary-cards">
                        <Card label="Pass Rate" value={passRate + '%'} className={passRate === 100 ? 'success' : passRate < 50 ? 'error' : ''} />
                        <Card label="Passed" value={summary.passed} className="success" />
                        <Card label="Failed" value={summary.failed} className={summary.failed > 0 ? 'error' : ''} />
                        <Card label="Total Tests" value={summary.total} />
                        <Card label="Total Tokens" value={summary.total_tokens.toLocaleString()} />
                        <Card label="Total Cost" value={'$' + summary.total_cost.toFixed(4)} />
                        <Card label="Duration" value={summary.total_duration_s + 's'} />
                        <Card label="Tool Calls" value={summary.total_tool_calls} />
                    </div>

                    <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
                        Run at: {new Date(timestamp).toLocaleString()} &bull; Avg duration: {summary.avg_duration_ms}ms &bull; Avg tool calls: {summary.avg_tool_calls}
                    </p>

                    <table>
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Test Name</th>
                                <th>Model</th>
                                <th>Message</th>
                                <th>Tokens</th>
                                <th>Cost</th>
                                <th>Duration</th>
                                <th>Tools</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.map((r, i) => (
                                <tr key={i} className="clickable" onClick={() => onSelect(r)}>
                                    <td><span className={'status ' + (r.passed ? 'pass' : 'fail')}>{r.passed ? '✓ Pass' : '✗ Fail'}</span></td>
                                    <td><strong>{r.name}</strong></td>
                                    <td><span className="model-badge">{r.model}</span></td>
                                    <td className="text-muted">{r.message}</td>
                                    <td className="mono">{(r.tokens || 0).toLocaleString()}</td>
                                    <td className="mono">${(r.cost || 0).toFixed(4)}</td>
                                    <td className="mono">{((r.duration_ms || 0) / 1000).toFixed(1)}s</td>
                                    <td className="mono">{r.tool_call_count || 0}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            );
        }

        function Card({ label, value, className = '' }) {
            return (
                <div className="card">
                    <div className="card-label">{label}</div>
                    <div className={'card-value ' + className}>{value}</div>
                </div>
            );
        }

        function Modal({ result, activeTab, setActiveTab, onClose }) {
            const details = result.details || {};

            useEffect(() => {
                const handleEsc = e => e.key === 'Escape' && onClose();
                document.addEventListener('keydown', handleEsc);
                return () => document.removeEventListener('keydown', handleEsc);
            }, [onClose]);

            return (
                <div className="modal-overlay" onClick={onClose}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{result.name}</h2>
                            <button className="modal-close" onClick={onClose}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="detail-section">
                                <h3>Overview</h3>
                                <div className="detail-grid">
                                    <DetailItem label="Status" value={result.passed ? '✓ Passed' : '✗ Failed'} />
                                    <DetailItem label="Model" value={result.model} />
                                    <DetailItem label="Message" value={result.message} />
                                    <DetailItem label="Tokens" value={(result.tokens || 0).toLocaleString()} />
                                    <DetailItem label="Cost" value={'$' + (result.cost || 0).toFixed(4)} />
                                    <DetailItem label="Duration" value={(result.duration_ms || 0) + 'ms'} />
                                    <DetailItem label="Tool Calls" value={result.tool_call_count || 0} />
                                </div>
                            </div>

                            {result.error && (
                                <div className="detail-section">
                                    <h3>Error</h3>
                                    <pre style={{ color: '#ef4444' }}>{result.error}</pre>
                                </div>
                            )}

                            {details.response_text && (
                                <div className="detail-section">
                                    <h3>Response</h3>
                                    <pre>{details.response_text}</pre>
                                </div>
                            )}

                            {details.tool_calls && details.tool_calls.length > 0 && (
                                <div className="detail-section">
                                    <h3>Tool Calls ({details.tool_calls.length})</h3>
                                    <ToolCallsList toolCalls={details.tool_calls} />
                                </div>
                            )}

                            {(details.actual_data || details.expected_data) && (
                                <div className="detail-section">
                                    <h3>Data Comparison</h3>
                                    <div className="tabs">
                                        <button className={'tab ' + (activeTab === 'actual' ? 'active' : '')} onClick={() => setActiveTab('actual')}>Actual</button>
                                        <button className={'tab ' + (activeTab === 'expected' ? 'active' : '')} onClick={() => setActiveTab('expected')}>Expected</button>
                                        {details.comparison && <button className={'tab ' + (activeTab === 'diff' ? 'active' : '')} onClick={() => setActiveTab('diff')}>Diff</button>}
                                    </div>
                                    {activeTab === 'actual' && <DataTable data={details.actual_data} />}
                                    {activeTab === 'expected' && <DataTable data={details.expected_data} />}
                                    {activeTab === 'diff' && details.comparison && <pre>{details.comparison}</pre>}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        function DetailItem({ label, value }) {
            return (
                <div className="detail-item">
                    <div className="label">{label}</div>
                    <div className="value">{value}</div>
                </div>
            );
        }

        function DataTable({ data }) {
            if (!data || data.length === 0) return <p className="text-muted">No data</p>;
            const columns = Object.keys(data[0]);
            return (
                <table className="data-table">
                    <thead>
                        <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                        {data.map((row, i) => (
                            <tr key={i}>{columns.map(c => <td key={c}>{String(row[c] ?? '')}</td>)}</tr>
                        ))}
                    </tbody>
                </table>
            );
        }

        function ToolCallsList({ toolCalls }) {
            const [expanded, setExpanded] = useState({});

            const toggle = (index) => {
                setExpanded(prev => ({ ...prev, [index]: !prev[index] }));
            };

            return (
                <div className="tool-calls-list">
                    {toolCalls.map((tc, i) => (
                        <div key={i} className="tool-call">
                            <div className="tool-call-header" onClick={() => toggle(i)}>
                                <span className="tool-call-index">{i + 1}</span>
                                <span className="tool-call-name">{tc.toolName}</span>
                                <span className="tool-call-expand">{expanded[i] ? '▼' : '▶'}</span>
                            </div>
                            {expanded[i] && (
                                <div className="tool-call-details">
                                    <div className="tool-call-section">
                                        <div className="tool-call-label">Arguments</div>
                                        <pre>{JSON.stringify(tc.args, null, 2)}</pre>
                                    </div>
                                    {tc.result !== undefined && (
                                        <div className="tool-call-section">
                                            <div className="tool-call-label">Result</div>
                                            <pre>{typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}</pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            );
        }

        ReactDOM.createRoot(document.getElementById('root')).render(<App />);
    </script>
</body>
</html>
"""


class TestResultsHandler(http.server.BaseHTTPRequestHandler):
    """Custom HTTP handler for serving test results."""

    def __init__(self, outputs_dir: Path, *args, **kwargs):
        self.outputs_dir = outputs_dir
        super().__init__(*args, **kwargs)

    def do_GET(self):
        """Handle GET requests."""
        if self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(get_html_template().encode())
        elif self.path == "/api/files":
            self.send_json_response(self.get_result_files())
        elif self.path.startswith("/api/results/"):
            filename = self.path[len("/api/results/") :]
            self.serve_result_file(filename)
        else:
            self.send_error(404, "Not Found")

    def get_result_files(self) -> list[str]:
        """Get list of result JSON files, sorted by most recent first."""
        if not self.outputs_dir.exists():
            return []
        files = sorted(self.outputs_dir.glob("results_*.json"), reverse=True)
        return [f.name for f in files]

    def serve_result_file(self, filename: str):
        """Serve a specific result file."""
        # Prevent path traversal
        if ".." in filename or "/" in filename:
            self.send_error(400, "Invalid filename")
            return

        filepath = self.outputs_dir / filename
        if not filepath.exists() or not filepath.is_file():
            self.send_error(404, "File not found")
            return

        try:
            data = json.loads(filepath.read_text())
            self.send_json_response(data)
        except Exception as e:
            self.send_error(500, str(e))

    def send_json_response(self, data):
        """Send a JSON response."""
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        """Suppress default logging."""
        pass


def server(
    port: Annotated[
        int,
        Parameter(
            name=["-p", "--port"],
            help="Port to run the server on.",
        ),
    ] = DEFAULT_PORT,
    no_open: Annotated[
        bool,
        Parameter(
            name=["--no-open"],
            help="Don't automatically open the browser.",
        ),
    ] = False,
):
    """Start a web server to explore test results.

    Opens a browser to view test results in a friendly web interface.

    Examples:
        nao test server
        nao test server --port 9000
        nao test server --no-open
    """
    config = NaoConfig.try_load(exit_on_error=True)
    assert config is not None

    project_path = Path.cwd()
    outputs_dir = project_path / TESTS_FOLDER / "outputs"

    if not outputs_dir.exists():
        UI.warn(f"No test outputs found at {outputs_dir}")
        UI.info("Run 'nao test' first to generate test results.")
        return

    result_files = list(outputs_dir.glob("results_*.json"))
    if not result_files:
        UI.warn("No result files found.")
        UI.info("Run 'nao test' first to generate test results.")
        return

    UI.info("\n📊 Starting nao test results server...\n")
    UI.print(f"[dim]Project: {config.project_name}[/dim]")
    UI.print(f"[dim]Results folder: {outputs_dir}[/dim]")
    UI.print(f"[dim]Found {len(result_files)} result file(s)[/dim]\n")

    url = f"http://localhost:{port}"

    # Create handler with outputs_dir bound using partial
    handler = partial(TestResultsHandler, outputs_dir)

    try:
        with socketserver.TCPServer(("", port), handler) as httpd:
            UI.success(f"Server running at {url}")
            UI.print("[dim]Press Ctrl+C to stop[/dim]\n")

            if not no_open:
                webbrowser.open(url)

            httpd.serve_forever()
    except KeyboardInterrupt:
        UI.print("\n[dim]Server stopped[/dim]")
    except OSError as e:
        if "Address already in use" in str(e):
            UI.error(f"Port {port} is already in use. Try a different port with --port")
        else:
            raise
