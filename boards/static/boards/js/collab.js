window.SketchSaathi = window.SketchSaathi || {};

SketchSaathi.collab = (() => {
  // the server closes with these codes when retrying cannot help (not signed in, board missing, message too big)
  const FINAL_CODES = [4401, 4404, 1009];
  const MAX_DELAY = 15000;

  let socket = null;
  let boardId = null;
  let retryTimer = null;
  let attempts = 0;
  let wasLive = false;
  let onEvent = () => {};
  let onState = () => {};
  let onReconnect = () => {};

  function open() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const current = new WebSocket(`${scheme}://${location.host}/ws/boards/${boardId}/`);
    socket = current;
    current.onopen = () => {
      const again = attempts > 0 && wasLive;
      attempts = 0;
      wasLive = true;
      onState('Live');
      // anything drawn while we were away is missed, so let the app reload the page
      if (again) onReconnect();
    };
    current.onclose = event => {
      if (socket !== current) return;
      if (FINAL_CODES.includes(event.code)) { onState('Offline'); return; }
      onState('Reconnecting…');
      const delay = Math.min(MAX_DELAY, 1000 * 2 ** attempts) + Math.random() * 400;
      attempts += 1;
      retryTimer = setTimeout(() => { if (boardId) open(); }, delay);
    };
    current.onmessage = msg => onEvent(JSON.parse(msg.data));
  }

  function connect(id) {
    disconnect();
    boardId = id;
    attempts = 0;
    wasLive = false;
    open();
  }

  function disconnect() {
    boardId = null;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (socket) { socket.onclose = null; socket.close(); }
    socket = null;
  }

  function send(event) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }

  // phones drop the socket when the tab sleeps; reconnect as soon as the person is back
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && boardId && socket && socket.readyState === WebSocket.CLOSED) {
      clearTimeout(retryTimer);
      attempts = 0;
      open();
    }
  });

  return {
    connect,
    disconnect,
    send,
    onEvent(fn) { onEvent = fn; },
    onState(fn) { onState = fn; },
    onReconnect(fn) { onReconnect = fn; },
  };
})();
