window.SketchSaathi = window.SketchSaathi || {};

SketchSaathi.presence = (() => {
  const IDLE_MS = 15000;
  const people = new Map();
  const layer = document.getElementById('cursors');
  const list = document.getElementById('people');
  let toScreen = (x, y) => [x, y];

  const colorFor = cid => `hsl(${[...cid].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)} 68% 46%)`;

  function cursorElement(person) {
    const el = document.createElement('div');
    el.className = 'cursor';
    el.style.setProperty('--c', person.color);
    el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 2-3 6z"/></svg><span></span>';
    el.querySelector('span').textContent = person.user;
    layer.appendChild(el);
    return el;
  }

  // one avatar per user, even with several tabs open
  function renderAvatars() {
    const seen = new Map();
    people.forEach(p => seen.set(p.user, p));
    list.innerHTML = '';
    [...seen.values()].slice(0, 5).forEach(p => {
      const a = document.createElement('span');
      a.className = 'avatar';
      a.title = p.user;
      a.style.setProperty('--c', p.color);
      a.textContent = p.user.charAt(0);
      list.appendChild(a);
    });
  }

  function place(person) {
    if (!person.el || person.x === undefined) return;
    const [sx, sy] = toScreen(person.x, person.y);
    person.el.style.transform = `translate(${sx}px, ${sy}px)`;
    person.el.style.display = Date.now() - person.seen > IDLE_MS ? 'none' : '';
  }

  function touch(event) {
    let person = people.get(event.cid);
    if (!person) {
      person = { user: event.user, color: colorFor(event.cid) };
      people.set(event.cid, person);
      renderAvatars();
    }
    person.seen = Date.now();
    return person;
  }

  return {
    colorFor,
    setProjection(fn) { toScreen = fn; people.forEach(place); },
    refresh() { people.forEach(place); },

    handle(event) {
      if (event.type === 'leave') {
        const person = people.get(event.cid);
        if (person && person.el) person.el.remove();
        people.delete(event.cid);
        renderAvatars();
        return true;
      }
      if (!['join', 'hello', 'cursor'].includes(event.type)) return false;
      const person = touch(event);
      if (event.type === 'cursor') {
        person.x = event.x;
        person.y = event.y;
        person.el = person.el || cursorElement(person);
        place(person);
      }
      return true;
    },

    clear() {
      people.forEach(p => p.el && p.el.remove());
      people.clear();
      renderAvatars();
    },
  };
})();
