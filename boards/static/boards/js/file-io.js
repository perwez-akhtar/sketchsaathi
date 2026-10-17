window.SketchSaathi = window.SketchSaathi || {};

SketchSaathi.fileIo = (() => {
  const FORMAT = 'sketchsaathi';
  const VERSION = 1;
  const MAX_BYTES = 12 * 1024 * 1024;
  const MAX_PAGES = 50;
  const MAX_ELEMENTS = 20000;
  const TYPES = ['pen', 'line', 'arrow', 'rectangle', 'diamond', 'ellipse', 'text', 'image', 'frame'];
  const PICKER_TYPES = [{ description: 'SketchSaathi drawing', accept: { 'application/json': ['.saathi'] } }];

  const safeName = title => (title || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled';

  async function saveFile({ title, pages }) {
    const json = JSON.stringify({ format: FORMAT, version: VERSION, title, pages }, null, 2);
    const name = `${safeName(title)}.saathi`;

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name, types: PICKER_TYPES });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        return handle.name;
      } catch (error) {
        if (error.name === 'AbortError') return null;
        throw error;
      }
    }

    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    link.click();
    URL.revokeObjectURL(url);
    return name;
  }

  async function pickFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES });
        return await handle.getFile();
      } catch (error) {
        if (error.name === 'AbortError') return null;
        throw error;
      }
    }
    return new Promise(resolve => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.saathi,application/json' });
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  }

  function parse(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('That file is not a SketchSaathi drawing.'); }
    if (!data || data.format !== FORMAT || !Array.isArray(data.pages) || !data.pages.length) {
      throw new Error('That file is not a SketchSaathi drawing.');
    }
    if (data.pages.length > MAX_PAGES) throw new Error('That drawing has too many pages.');

    const pages = data.pages.map((page, index) => {
      const elements = Array.isArray(page.elements) ? page.elements : [];
      if (elements.length > MAX_ELEMENTS) throw new Error('That drawing is too large.');
      return {
        name: String(page.name || `Page ${index + 1}`).slice(0, 100),
        background: /^#[0-9a-f]{6}$/i.test(page.background) ? page.background : '#ffffff',
        elements: elements.filter(el => el && TYPES.includes(el.type) && typeof el.id === 'string'),
      };
    });
    return { title: String(data.title || 'Untitled').slice(0, 200), pages };
  }

  async function openFile() {
    const file = await pickFile();
    if (!file) return null;
    if (file.size > MAX_BYTES) throw new Error('That file is too big to open.');
    return parse(await file.text());
  }

  return { saveFile, openFile };
})();
