window.SketchSaathi = window.SketchSaathi || {};

// same calls as SketchSaathi.api, but saved in this browser for visitors without an account
SketchSaathi.localStore = (() => {
  const KEY = 'sketchsaathi.guest';
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const now = () => new Date().toISOString();
  const copy = value => JSON.parse(JSON.stringify(value));

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || { boards: {} }; } catch { return { boards: {} }; }
  }

  function write(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      throw new Error('This browser is out of space for drawings. Sign up to keep larger boards in your account.');
    }
  }

  const summary = page => ({ uuid: page.uuid, name: page.name, position: page.position, background: page.background });
  const boardView = board => ({
    uuid: board.uuid, title: board.title, is_owner: true,
    created_at: board.created_at, updated_at: board.updated_at,
    pages: board.pages.map(summary),
  });

  function findPage(data, uuid) {
    for (const board of Object.values(data.boards)) {
      const page = board.pages.find(p => p.uuid === uuid);
      if (page) return { board, page };
    }
    throw new Error('Page not found');
  }

  function boardOf(data, uuid) {
    const board = data.boards[uuid];
    if (!board) throw new Error('Board not found');
    return board;
  }

  return {
    async listBoards() {
      return Object.values(read().boards)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(boardView);
    },
    async getBoard(uuid) {
      return boardView(boardOf(read(), uuid));
    },
    async createBoard(title) {
      const data = read();
      const board = {
        uuid: newId(), title, created_at: now(), updated_at: now(),
        pages: [{ uuid: newId(), name: 'Page 1', position: 0, elements: [], background: '#ffffff' }],
      };
      data.boards[board.uuid] = board;
      write(data);
      return boardView(board);
    },
    async renameBoard(uuid, title) {
      const data = read();
      Object.assign(boardOf(data, uuid), { title, updated_at: now() });
      write(data);
      return boardView(data.boards[uuid]);
    },
    async deleteBoard(uuid) {
      const data = read();
      delete data.boards[uuid];
      write(data);
      return null;
    },
    async addPage(boardUuid, name) {
      const data = read();
      const board = boardOf(data, boardUuid);
      const position = Math.max(-1, ...board.pages.map(p => p.position)) + 1;
      const page = { uuid: newId(), name, position, elements: [], background: '#ffffff' };
      board.pages.push(page);
      board.updated_at = now();
      write(data);
      return copy(page);
    },
    async getPage(uuid) {
      return copy(findPage(read(), uuid).page);
    },
    async updatePage(uuid, changes) {
      const data = read();
      const { board, page } = findPage(data, uuid);
      ['name', 'elements', 'background', 'position'].forEach(key => {
        if (key in changes) page[key] = copy(changes[key]);
      });
      board.updated_at = now();
      write(data);
      return copy(page);
    },
    async deletePage(uuid) {
      const data = read();
      const { board, page } = findPage(data, uuid);
      if (board.pages.length <= 1) throw new Error('A board needs at least one page.');
      board.pages = board.pages.filter(p => p !== page);
      board.updated_at = now();
      write(data);
      return null;
    },

    boardsWithContent() {
      return Object.values(read().boards)
        .filter(board => board.pages.some(page => page.elements.length))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
        .map(copy);
    },
    clear() {
      try { localStorage.removeItem(KEY); localStorage.removeItem('sketchsaathi.guest.last'); } catch {}
    },
  };
})();

if (document.body.dataset.guest === '1') {
  SketchSaathi.serverApi = SketchSaathi.api;
  SketchSaathi.api = SketchSaathi.localStore;
}
