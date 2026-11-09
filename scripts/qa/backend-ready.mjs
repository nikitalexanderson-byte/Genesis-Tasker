/** Require this invocation's synthetic identity, not merely an occupied loopback port. */
export async function waitForQaBackend(child, origin, runId, timeoutMs = 20_000) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || !/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('Owned loopback QA server required');
  let startError;
  const onError = error => { startError = error; };
  child.on('error', onError);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (startError) throw startError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('QA backend exited before readiness');
      let response;
      try { response = await fetch(`${origin}/api/qa/identity`, { signal: AbortSignal.timeout(1000) }); }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
      if (!response.ok) throw new Error(`Unexpected listener on QA backend port: HTTP ${response.status}`);
      const identity = await response.json();
      if (identity.synthetic !== true || identity.runId !== runId) throw new Error('QA backend ownership mismatch');
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('QA backend exited during readiness');
      return;
    }
    throw new Error('Owned QA backend did not become ready');
  } finally { child.off('error', onError); }
}
