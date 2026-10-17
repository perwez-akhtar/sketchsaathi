// Thin wrapper around the REST API. Boards and pages are addressed by uuid.
window.SketchSaathi = window.SketchSaathi || {};

SketchSaathi.api = (() => {
  const csrfToken = () => (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || '';

  async function request(url, options = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken(),
        ...(options.headers || {}),
      },
    });
    if ((res.status === 401 || res.status === 403) && (!options.method || options.method === 'GET')) {
      location.href = '/login/';
    }
    if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} failed (${res.status})`);
    return res.status === 204 ? null : res.json();
  }

  const send = (method, url, body) => request(url, { method, body: JSON.stringify(body) });

  return {
    // Boards
    async listBoards() {
      return (await request('/api/boards/?ordering=-updated_at')).results;
    },
    getBoard: uuid => request(`/api/boards/${uuid}/`),
    createBoard: title => send('POST', '/api/boards/', { title }),
    renameBoard: (uuid, title) => send('PATCH', `/api/boards/${uuid}/`, { title }),
    deleteBoard: uuid => request(`/api/boards/${uuid}/`, { method: 'DELETE' }),

    // Pages (tabs)
    addPage: (boardUuid, name) => send('POST', `/api/boards/${boardUuid}/pages/`, { name }),
    getPage: uuid => request(`/api/pages/${uuid}/`),
    updatePage: (uuid, changes) => send('PATCH', `/api/pages/${uuid}/`, changes),
    deletePage: uuid => request(`/api/pages/${uuid}/`, { method: 'DELETE' }),
  };
})();
