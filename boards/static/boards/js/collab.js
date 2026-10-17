// Real-time sync over WebSocket: sends local edits and applies edits from others.
window.SketchSaathi = window.SketchSaathi || {};

SketchSaathi.collab = (() => {
  let socket = null;
  let onEvent = () => {};
  let onState = () => {};

  function connect(boardId) {
    disconnect();
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${scheme}://${location.host}/ws/boards/${boardId}/`);
    socket.onopen = () => onState('Live');
    socket.onclose = () => onState('Offline');
    socket.onmessage = msg => onEvent(JSON.parse(msg.data));
  }

  function disconnect() {
    if (socket) { socket.onclose = null; socket.close(); }
    socket = null;
  }

  function send(event) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }

  return {
    connect,
    disconnect,
    send,
    onEvent(fn) { onEvent = fn; },
    onState(fn) { onState = fn; },
  };
})();
