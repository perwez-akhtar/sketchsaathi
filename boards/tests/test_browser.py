import asyncio
import os
import sys
import unittest
from pathlib import Path

from django.contrib.auth.models import User
from django.contrib.staticfiles.testing import StaticLiveServerTestCase

from boards.models import Board

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

ENABLED = os.environ.get('RUN_BROWSER_TESTS') == '1' and sync_playwright is not None


@unittest.skipUnless(ENABLED, 'set RUN_BROWSER_TESTS=1 (and pip install playwright) to run browser tests')
class BrowserTests(StaticLiveServerTestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.setdefault('DJANGO_ALLOW_ASYNC_UNSAFE', 'true')
        if sys.platform == 'win32':
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        super().setUpClass()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(channel='msedge')

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        super().tearDownClass()

    def setUp(self):
        User.objects.create_user('alice', password='pw-12345-x')
        self.page = self.browser.new_page(viewport={'width': 1366, 'height': 800})
        self.errors = []
        self.page.on('pageerror', lambda exc: self.errors.append(str(exc)))
        self.page.goto(f'{self.live_server_url}/login/')
        self.page.fill('input[name=username]', 'alice')
        self.page.fill('input[name=password]', 'pw-12345-x')
        self.page.click('button[type=submit]')
        self.page.wait_for_function('window.SketchSaathi && SketchSaathi.ready')
        self.page.evaluate("document.fonts.load('20px Caveat').then(() => document.fonts.ready).then(() => true)")

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [], 'JavaScript errors on the page')

    def shot(self, name):
        folder = os.environ.get('SCREENSHOT_DIR')
        if folder:
            Path(folder).mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(Path(folder) / f'{name}.png'))

    def elements(self):
        return self.page.evaluate('SketchSaathi.canvas.getElements()')

    def drag(self, start, end):
        self.page.mouse.move(*start)
        self.page.mouse.down()
        self.page.mouse.move((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
        self.page.mouse.move(*end)
        self.page.mouse.up()

    def test_properties_panel_lays_out_in_rows(self):
        self.shot('01-empty')
        tops = {round(self.page.locator('#colors .dot').nth(i).bounding_box()['y']) for i in range(5)}
        self.assertEqual(len(tops), 1, 'stroke colours should sit on one row')
        tops = {round(self.page.locator('#widths .opt').nth(i).bounding_box()['y']) for i in range(3)}
        self.assertEqual(len(tops), 1, 'stroke widths should sit on one row')

    def test_draw_select_resize_and_restyle(self):
        self.page.keyboard.press('r')
        self.drag((500, 300), (700, 420))
        self.assertEqual([e['type'] for e in self.elements()], ['rectangle'])

        self.page.keyboard.press('v')
        self.page.mouse.click(600, 300)
        self.assertTrue(self.page.is_visible('#selectionTools'))
        self.shot('02-selected')

        before = self.elements()[0]['width']
        self.drag((706, 426), (806, 486))
        self.assertGreater(self.elements()[0]['width'], before + 50)

        self.page.click('#strokeStyles [data-stroke=dashed]')
        self.page.click('#edges [data-round="1"]')
        self.page.click('#fills [data-fill="#a5d8ff"]')
        rect = self.elements()[0]
        self.assertEqual((rect['strokeStyle'], rect.get('round'), rect.get('fill')), ('dashed', True, '#a5d8ff'))

        self.page.click('#duplicate')
        self.assertEqual(len(self.elements()), 2)
        self.shot('03-restyled')

    def test_pages_and_theme(self):
        self.page.keyboard.press('p')
        self.drag((400, 300), (600, 400))
        self.page.click('#addPage')
        self.page.wait_for_function("document.querySelectorAll('.tab').length === 2")
        self.assertEqual(self.elements(), [])
        self.assertEqual(self.page.url, f'{self.live_server_url}/')
        last = self.page.evaluate("JSON.parse(localStorage.getItem('sketchsaathi.last'))")
        self.assertTrue(last['board'] and last['page'])

        self.page.reload()
        self.page.wait_for_function("document.querySelectorAll('.tab').length === 2")

        self.page.click('.tab >> nth=0')
        self.page.wait_for_function('SketchSaathi.canvas.getElements().length === 1')

        self.page.click('#theme')
        self.assertEqual(self.page.evaluate('document.documentElement.dataset.theme'), 'dark')
        self.shot('04-pages-dark')

    def test_text_can_be_added_edited_and_styled(self):
        self.page.keyboard.press('t')
        self.assertTrue(self.page.is_visible('#textProps'))
        self.assertFalse(self.page.is_visible('#shapeProps'))
        self.page.mouse.click(400, 300)
        self.page.keyboard.type('Hello')
        self.page.click('#fontSizes [data-font-size="36"]')
        self.page.keyboard.press('Escape')
        text = self.elements()[0]
        self.assertEqual((text['type'], text['text'], text['fontSize']), ('text', 'Hello', 36))

        self.page.keyboard.press('v')
        self.page.mouse.dblclick(410, 315)
        self.page.wait_for_selector('.text-editor')
        self.page.keyboard.press('End')
        self.page.keyboard.type(' world')
        self.page.click('#fontFamilies [data-font=mono]')
        self.page.click('#aligns [data-align=center]')
        self.shot('05-editing-text')
        self.page.mouse.click(900, 600)
        text = self.elements()[0]
        self.assertEqual((text['text'], text['fontFamily'], text['align']), ('Hello world', 'mono', 'center'))

        self.page.mouse.click(410, 315)
        self.page.keyboard.press('Enter')
        self.page.keyboard.press('Control+a')
        self.page.keyboard.press('Delete')
        self.page.keyboard.press('Escape')
        self.assertEqual(self.elements(), [])

    def test_shift_constrains_shapes_and_lines(self):
        self.page.keyboard.press('r')
        self.page.keyboard.down('Shift')
        self.drag((300, 300), (420, 360))
        self.page.keyboard.up('Shift')
        self.page.keyboard.press('l')
        self.page.keyboard.down('Shift')
        self.drag((500, 300), (700, 310))
        self.page.keyboard.up('Shift')
        square, line = self.elements()
        self.assertAlmostEqual(abs(square['width']), abs(square['height']), places=3)
        self.assertAlmostEqual(line['height'], 0, places=3)

    def clipboard(self, action, text=None):
        return self.page.evaluate("""([action, text]) => {
            const data = new DataTransfer();
            if (text) data.setData('text/plain', text);
            document.dispatchEvent(new ClipboardEvent(action, { clipboardData: data, bubbles: true, cancelable: true }));
            return data.getData('text/plain');
        }""", [action, text])

    def draw_two_rectangles(self):
        self.page.keyboard.press('r')
        self.drag((300, 300), (400, 380))
        self.page.keyboard.press('r')
        self.drag((500, 300), (600, 380))
        self.page.keyboard.press('v')

    def test_new_sketch_is_autosaved_and_close_warns_while_unsaved(self):
        self.assertEqual(Board.objects.filter(owner__username='alice').count(), 0)
        self.page.keyboard.press('r')
        self.drag((300, 300), (400, 380))
        self.assertTrue(self.page.evaluate(
            "(() => { const e = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(e); return e.defaultPrevented; })()"))
        self.page.wait_for_function("document.getElementById('status').textContent === 'Saved'", timeout=15000)
        board = Board.objects.get(owner__username='alice')
        self.assertEqual([e['type'] for e in board.pages.first().elements], ['rectangle'])
        self.assertFalse(self.page.evaluate(
            "(() => { const e = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(e); return e.defaultPrevented; })()"))

    def test_style_panel_can_be_hidden_and_shown_again(self):
        self.assertTrue(self.page.is_visible('.style'))
        self.page.click('#styleHandle')
        self.page.wait_for_selector('.style', state='hidden')
        self.page.keyboard.press('Escape')
        self.assertFalse(self.page.is_visible('.style'))
        self.assertTrue(self.page.is_visible('#styleHandle'))
        self.page.click('#styleHandle')
        self.page.wait_for_selector('.style', state='visible')
        self.assertEqual(self.page.get_attribute('#styleHandle', 'aria-expanded'), 'true')

    def test_select_all_marquee_shift_click_and_nudge(self):
        self.draw_two_rectangles()
        self.page.keyboard.press('Control+a')
        self.assertEqual(len(self.page.evaluate('SketchSaathi.canvas.getSelectedList()')), 2)
        self.page.keyboard.press('Escape')
        self.assertEqual(self.page.evaluate('SketchSaathi.canvas.getSelectedList()'), [])

        self.drag((250, 250), (450, 420))
        self.assertEqual(len(self.page.evaluate('SketchSaathi.canvas.getSelectedList()')), 1)
        self.page.keyboard.down('Shift')
        self.page.mouse.click(550, 300)
        self.page.keyboard.up('Shift')
        self.assertEqual(len(self.page.evaluate('SketchSaathi.canvas.getSelectedList()')), 2)
        self.shot('06-multi-select')

        before = [e['x'] for e in self.elements()]
        self.page.keyboard.press('Shift+ArrowRight')
        self.assertEqual([e['x'] for e in self.elements()], [x + 10 for x in before])

        self.page.click('#strokeStyles [data-stroke=dotted]')
        self.assertEqual({e['strokeStyle'] for e in self.elements()}, {'dotted'})

    def test_copy_paste_cut_and_shortcuts(self):
        self.draw_two_rectangles()
        self.page.keyboard.press('Control+a')
        copied = self.clipboard('copy')
        self.assertIn('sketchsaathi/elements', copied)
        self.page.mouse.move(700, 600)
        self.clipboard('paste', copied)
        self.assertEqual(len(self.elements()), 4)
        self.clipboard('cut')
        self.assertEqual(len(self.elements()), 2)
        self.clipboard('paste', 'Plain text from elsewhere')
        self.assertEqual(self.elements()[-1]['text'], 'Plain text from elsewhere')
        self.page.keyboard.press('Delete')
        self.page.keyboard.press('Control+a')
        self.page.keyboard.press('Control+d')
        self.assertEqual(len(self.elements()), 4)

        self.page.keyboard.press('Control+=')
        self.page.wait_for_function("document.querySelector('#zoomReset').textContent === '120%'")
        self.assertFalse(self.page.is_disabled('#zoomResetIcon'))
        self.page.click('#zoomResetIcon')
        self.page.wait_for_function("document.querySelector('#zoomReset').textContent === '100%'")
        self.page.wait_for_function("document.getElementById('zoomResetIcon').disabled")
        self.page.keyboard.press('Control+=')
        self.page.keyboard.press('Control+0')
        self.page.wait_for_function("document.querySelector('#zoomReset').textContent === '100%'")
        self.page.keyboard.press('4')
        self.assertIn('active', self.page.get_attribute('[data-tool=ellipse]', 'class'))

        self.page.keyboard.press('?')
        self.assertTrue(self.page.is_visible('#help'))
        self.shot('07-help')
        self.page.keyboard.press('Escape')
        self.assertFalse(self.page.is_visible('#help'))

        self.page.click('#clearTool')
        self.page.wait_for_selector('.ui-dialog')
        self.page.wait_for_timeout(300)
        self.shot('08-confirm-dialog')
        self.page.click('.ui-dialog .ui-confirm')
        self.page.wait_for_function('SketchSaathi.canvas.getElements().length === 0')
        self.page.wait_for_selector('.ui-dialog', state='detached')

    def test_more_tools_frame_bucket_lasso_laser_and_image(self):
        import base64
        import tempfile

        self.page.click('#moreButton')
        self.assertTrue(self.page.is_visible('#moreMenu'))
        self.shot('09-more-menu')
        self.page.click('#moreMenu [data-tool=frame]')
        self.assertFalse(self.page.is_visible('#moreMenu'))
        self.drag((300, 200), (700, 500))
        self.page.keyboard.press('r')
        self.drag((350, 250), (450, 330))
        frame, rect = self.elements()
        self.assertEqual((frame['type'], rect['type']), ('frame', 'rectangle'))

        self.page.keyboard.press('v')
        self.drag((302, 350), (402, 350))
        frame, rect = self.elements()
        self.assertEqual(rect['x'], 450)

        self.page.keyboard.press('b')
        self.page.click('#colors [data-color="#e03131"]')
        self.page.mouse.click(550, 290)
        self.assertEqual(self.elements()[1]['fill'], '#e03131')

        self.page.keyboard.press('Shift+L')
        self.page.mouse.move(430, 230)
        self.page.mouse.down()
        for point in [(580, 230), (580, 350), (430, 350), (430, 232)]:
            self.page.mouse.move(*point)
        self.page.mouse.up()
        selected = self.page.evaluate('SketchSaathi.canvas.getSelectedList().map(e => e.type)')
        self.assertEqual(selected, ['rectangle'])

        self.page.keyboard.press('k')
        self.page.mouse.move(800, 300)
        self.page.mouse.down()
        for step in range(1, 11):
            self.page.mouse.move(800 + step * 15, 300 + step * 8)
        self.shot('11-laser')
        self.page.mouse.up()
        self.assertEqual(len(self.elements()), 2)

        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDGgAQYGBgB9mQH/LWtjNwAAAABJRU5ErkJggg==')
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            f.write(png)
        self.page.set_input_files('#imageFile', f.name)
        self.page.wait_for_function("SketchSaathi.canvas.getElements().some(e => e.type === 'image')")
        image = self.elements()[-1]
        self.assertTrue(image['src'].startswith('data:image/'))
        os.unlink(f.name)
        self.shot('10-more-tools')

    def test_ctrl_click_adds_to_selection(self):
        self.draw_two_rectangles()
        self.page.mouse.click(350, 300)
        self.page.keyboard.down('Control')
        self.page.mouse.click(550, 300)
        self.page.keyboard.up('Control')
        self.assertEqual(len(self.page.evaluate('SketchSaathi.canvas.getSelectedList()')), 2)

    def test_text_box_wraps_and_side_handles_change_width(self):
        self.page.keyboard.press('t')
        self.drag((300, 300), (460, 300))
        self.page.wait_for_selector('.text-editor')
        self.page.keyboard.type('The quick brown fox jumps over the lazy dog')
        self.page.keyboard.press('Escape')
        text = self.elements()[0]
        self.assertAlmostEqual(text['boxWidth'], 160, delta=1)
        self.assertEqual(text['text'], 'The quick brown fox jumps over the lazy dog')

        self.page.keyboard.press('v')
        self.page.mouse.click(320, 310)
        self.shot('12-text-before-edit')
        self.page.keyboard.press('Enter')
        self.page.wait_for_selector('.text-editor')
        self.shot('13-text-editing')
        self.page.keyboard.press('Escape')

        ex, ey = text['x'], text['y']
        self.page.mouse.click(ex + 20, ey + 10)
        self.page.mouse.move(ex + 160 + 6, ey + 30)
        self.assertEqual(self.page.evaluate("document.querySelector('canvas').style.cursor"), 'ew-resize')
        self.page.mouse.down()
        self.page.mouse.move(ex + 300, ey + 30)
        self.page.mouse.move(ex + 366, ey + 30)
        self.page.mouse.up()
        self.assertGreater(self.elements()[0]['boxWidth'], 300)
        self.shot('14-text-widened')

    def test_switching_windows_while_holding_space_does_not_get_stuck(self):
        self.page.keyboard.down('Space')
        self.page.evaluate("window.dispatchEvent(new Event('blur'))")
        self.assertNotIn('hand', self.page.get_attribute('canvas', 'class') or '')
        self.page.keyboard.press('p')
        self.drag((400, 300), (500, 350))
        self.assertEqual([e['type'] for e in self.elements()], ['pen'])

    def test_landing_and_auth_pages(self):
        visitor = self.browser.new_page(viewport={'width': 1366, 'height': 800})
        errors = []
        visitor.on('pageerror', lambda exc: errors.append(str(exc)))
        visitor.goto(f'{self.live_server_url}/')
        self.assertTrue(visitor.is_visible('text=Sketch ideas'))
        self.assertTrue(visitor.evaluate("getComputedStyle(document.body).getPropertyValue('--bs-blue').trim()"))
        folder = os.environ.get('SCREENSHOT_DIR')
        if folder:
            visitor.screenshot(path=str(Path(folder) / '15-landing.png'), full_page=True)
        visitor.click('#themeToggle')
        self.assertEqual(visitor.evaluate("document.documentElement.dataset.bsTheme"), 'dark')
        if folder:
            visitor.screenshot(path=str(Path(folder) / '16-landing-dark.png'))
        visitor.click('nav >> text=Sign up free')
        visitor.wait_for_selector('input[name=password2]')
        if folder:
            visitor.screenshot(path=str(Path(folder) / '17-signup-dark.png'))
        visitor.close()
        self.assertEqual(errors, [])

    def test_guest_can_draw_then_sign_up_and_keep_the_sketch(self):
        guest = self.browser.new_context(viewport={'width': 1366, 'height': 800}).new_page()
        errors = []
        guest.on('pageerror', lambda exc: errors.append(str(exc)))
        guest.goto(f'{self.live_server_url}/')
        guest.click('text=Start drawing – no sign-up')
        guest.wait_for_function('window.SketchSaathi && SketchSaathi.ready')
        self.assertTrue(guest.url.endswith('/draw/'))
        guest.keyboard.press('r')
        guest.mouse.move(400, 300); guest.mouse.down(); guest.mouse.move(500, 360); guest.mouse.up()
        guest.click('#addPage')
        guest.wait_for_function("document.querySelectorAll('.tab').length === 2")
        guest.wait_for_timeout(1700)
        guest.reload()
        guest.wait_for_function("document.querySelectorAll('.tab').length === 2")
        self.assertTrue(guest.url.endswith('/draw/'))

        guest.click('#share')
        guest.click('.ui-dialog .ui-confirm')
        guest.wait_for_selector('input[name=password1]')
        folder = os.environ.get('SCREENSHOT_DIR')
        guest.fill('input[name=email]', 'newbie@example.com')
        guest.fill('input[name=password1]', 'Str0ng-pass-99!')
        guest.fill('input[name=password2]', 'Str0ng-pass-99!')
        if folder:
            guest.wait_for_timeout(400)
            guest.screenshot(path=str(Path(folder) / '18-signup-filled.png'))
        guest.click('button[type=submit]')
        guest.wait_for_function('window.SketchSaathi && SketchSaathi.ready')
        guest.wait_for_function("document.querySelectorAll('.tab').length === 2")
        board = Board.objects.get(owner__email='newbie@example.com')
        self.assertEqual(board.pages.count(), 2)
        self.assertEqual([e['type'] for e in board.pages.order_by('position').first().elements], ['rectangle'])
        self.assertIsNone(guest.evaluate("localStorage.getItem('sketchsaathi.guest')"))
        guest.context.close()
        self.assertEqual(errors, [])

    def test_login_page_shows_errors_and_toggles_password(self):
        visitor = self.browser.new_context(viewport={'width': 1366, 'height': 800}).new_page()
        visitor.goto(f'{self.live_server_url}/login/')
        visitor.fill('input[name=username]', 'alice')
        visitor.fill('input[name=password]', 'wrong-password')
        visitor.click('.toggle-password')
        self.assertEqual(visitor.get_attribute('input[name=password]', 'type'), 'text')
        visitor.click('button[type=submit]')
        visitor.wait_for_selector('.alert-danger')
        folder = os.environ.get('SCREENSHOT_DIR')
        if folder:
            visitor.wait_for_timeout(400)
            visitor.screenshot(path=str(Path(folder) / '19-login-error.png'))
        visitor.context.close()

    def test_landing_preview_opens_the_editor(self):
        visitor = self.browser.new_context(viewport={'width': 1366, 'height': 800}).new_page()
        visitor.goto(f'{self.live_server_url}/')
        self.assertTrue(visitor.is_visible('.preview-badge'))
        visitor.hover('.preview-link')
        visitor.wait_for_timeout(300)
        self.assertTrue(visitor.is_visible('text=Click to start drawing'))
        folder = os.environ.get('SCREENSHOT_DIR')
        if folder:
            visitor.screenshot(path=str(Path(folder) / '20-landing-preview-hover.png'))
        visitor.click('.preview-link')
        visitor.wait_for_function('window.SketchSaathi && SketchSaathi.ready')
        self.assertTrue(visitor.url.endswith('/draw/'))
        visitor.context.close()

    def phone(self, url):
        page = self.browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                                        device_scale_factor=2).new_page()
        page.goto(f'{self.live_server_url}{url}')
        return page

    def test_phone_editor_sheet_and_pinch_zoom(self):
        page = self.phone('/draw/')
        page.wait_for_function('window.SketchSaathi && SketchSaathi.ready')
        self.assertFalse(page.is_visible('.style'))
        folder = os.environ.get('SCREENSHOT_DIR')
        if folder:
            page.screenshot(path=str(Path(folder) / '22-phone-editor.png'))
        page.tap('#styleToggle')
        self.assertTrue(page.is_visible('.style'))
        box = page.locator('.style').bounding_box()
        self.assertGreaterEqual(box['x'], 0)
        self.assertLessEqual(box['x'] + box['width'], 390)
        if folder:
            page.wait_for_timeout(250)
            page.screenshot(path=str(Path(folder) / '23-phone-style-sheet.png'))
        page.tap('#styleToggle')
        self.assertFalse(page.is_visible('.style'))

        page.evaluate("""(() => {
            const c = document.querySelector('canvas');
            const fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, {
                pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
            fire('pointerdown', 1, 150, 400);
            fire('pointermove', 1, 152, 400);
            fire('pointerdown', 2, 240, 400);
            fire('pointermove', 1, 100, 400);
            fire('pointermove', 2, 300, 400);
            fire('pointerup', 1, 100, 400);
            fire('pointerup', 2, 300, 400);
        })()""")
        zoom = int(page.inner_text('#zoomReset').rstrip('%'))
        self.assertGreater(zoom, 150)
        self.assertEqual(page.evaluate('SketchSaathi.canvas.getElements().length'), 0)
        page.context.close()

    def test_phone_landing_and_login(self):
        page = self.phone('/')
        self.assertTrue(page.is_visible('.btn-hero'))
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)
        folder = os.environ.get('SCREENSHOT_DIR')
        if folder:
            page.screenshot(path=str(Path(folder) / '24-phone-landing.png'))
        page.goto(f'{self.live_server_url}/login/')
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth'), 390)
        if folder:
            page.wait_for_timeout(400)
            page.screenshot(path=str(Path(folder) / '25-phone-login.png'))
        page.context.close()

    def test_scroll_back_to_content(self):
        self.page.keyboard.press('r')
        self.drag((400, 300), (500, 360))
        self.assertTrue(self.page.is_hidden('#scrollBack'))
        self.page.mouse.move(600, 400)
        for _ in range(12):
            self.page.mouse.wheel(0, 400)
        self.page.wait_for_selector('#scrollBack', state='visible')
        folder = os.environ.get('SCREENSHOT_DIR')
        if folder:
            self.page.screenshot(path=str(Path(folder) / '26-scroll-back.png'))
        self.page.click('#scrollBack')
        self.page.wait_for_selector('#scrollBack', state='hidden')
        self.page.wait_for_timeout(400)
        self.assertEqual(self.page.inner_text('#zoomReset'), '100%')

        self.page.keyboard.press('Shift+1')
        self.page.wait_for_timeout(450)
        self.assertEqual(self.page.inner_text('#zoomReset'), '100%')

    def menu(self, x, y):
        self.page.mouse.click(x, y, button='right')
        self.page.wait_for_selector('#contextMenu', state='visible')

    def menu_pick(self, label):
        self.page.click(f'#contextMenu .context-item:has-text("{label}")')

    def test_right_click_menu(self):
        self.page.keyboard.press('r')
        self.drag((300, 300), (400, 380))
        self.page.keyboard.press('r')
        self.page.click('#strokeStyles [data-stroke=dashed]')
        self.page.click('#colors [data-color="#e03131"]')
        self.drag((500, 300), (600, 380))
        self.page.keyboard.press('v')

        self.menu(550, 300)
        self.shot('27-context-menu')
        self.menu_pick('Copy styles')
        self.menu(350, 300)
        self.menu_pick('Paste styles')
        a = self.elements()[0]
        self.assertEqual((a['color'], a['strokeStyle']), ('#e03131', 'dashed'))

        before = self.elements()[0]['x']
        self.page.keyboard.press('Control+a')
        self.menu(350, 300)
        self.menu_pick('Flip horizontal')
        self.assertNotEqual(self.elements()[0]['x'], before)

        self.page.keyboard.press('Escape')
        self.menu(350, 300)
        self.menu_pick('Copy')
        self.menu(700, 550)
        self.assertTrue(self.page.is_visible('#contextMenu .context-item:has-text("Select all")'))
        self.menu_pick('Paste')
        self.page.wait_for_function('SketchSaathi.canvas.getElements().length === 3')

        self.menu(350, 300)
        self.menu_pick('Lock')
        self.page.mouse.click(350, 300)
        self.assertEqual(self.page.evaluate('SketchSaathi.canvas.getSelectedList().length'), 0)
        self.menu(350, 300)
        self.assertEqual(self.page.locator('#contextMenu .context-item').count(), 1)
        self.menu_pick('Unlock')
        self.assertEqual(self.page.evaluate('SketchSaathi.canvas.getSelectedList().length'), 1)

        self.menu(350, 300)
        self.menu_pick('Wrap selection in frame')
        self.assertEqual(self.elements()[0]['type'], 'frame')
        self.page.keyboard.press('Escape')
        self.assertTrue(self.page.is_hidden('#contextMenu'))

    def test_undo_redo_covers_every_kind_of_change(self):
        undo = lambda: self.page.keyboard.press('Control+z')
        redo = lambda: self.page.keyboard.press('Control+Shift+z')
        self.page.keyboard.press('r')
        self.drag((300, 300), (400, 380))
        self.page.keyboard.press('r')
        self.drag((500, 300), (600, 380))
        self.page.keyboard.press('v')

        self.drag((350, 300), (350, 200))
        self.assertEqual(self.elements()[0]['y'], 200)
        undo()
        self.assertEqual(self.elements()[0]['y'], 300)
        redo()
        self.assertEqual(self.elements()[0]['y'], 200)

        self.page.click('#colors [data-color="#e03131"]')
        undo()
        self.assertEqual(self.elements()[0]['color'], '#1e1e1e')

        self.page.keyboard.press('Control+a')
        self.page.keyboard.press('Shift+ArrowRight')
        undo()
        self.assertEqual([e['x'] for e in self.elements()], [300, 500])

        self.page.keyboard.press('Control+Shift+[')
        self.assertEqual(self.elements()[0]['x'], 300)
        self.page.keyboard.press('Escape')
        self.page.mouse.click(550, 300)
        self.page.keyboard.press('Control+Shift+[')
        first = self.elements()[0]['x']
        undo()
        self.assertNotEqual(self.elements()[0]['x'], first)

        self.page.keyboard.press('Control+a')
        self.page.keyboard.press('Delete')
        self.assertEqual(self.elements(), [])
        undo()
        self.assertEqual(len(self.elements()), 2)

        self.page.click('#clearTool')
        self.page.click('.ui-dialog .ui-confirm')
        self.page.wait_for_function('SketchSaathi.canvas.getElements().length === 0')
        undo()
        self.assertEqual(len(self.elements()), 2)
        self.page.wait_for_function("!document.getElementById('redo').disabled")

    def test_phone_drawing_lands_under_the_finger_even_after_a_lost_touch(self):
        page = self.phone('/draw/')
        page.wait_for_function('window.SketchSaathi && SketchSaathi.ready')
        page.evaluate("""(() => {
            const c = document.querySelector('canvas');
            const fire = (type, id, x, y, primary) => c.dispatchEvent(new PointerEvent(type, {
                pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: primary }));
            fire('pointerdown', 7, 50, 200, true);          // a touch whose "lifted" event never arrives
            fire('pointerdown', 8, 100, 300, true);         // next, a normal one-finger stroke
            for (let i = 1; i <= 10; i++) fire('pointermove', 8, 100 + i * 10, 300 + i * 5, true);
            fire('pointerup', 8, 200, 350, true);
        })()""")
        self.assertEqual(page.inner_text('#zoomReset'), '100%')
        stroke = page.evaluate('SketchSaathi.canvas.getElements()[0]')
        self.assertEqual(stroke['type'], 'pen')
        self.assertEqual(stroke['points'][0], [100, 300])
        self.assertEqual(stroke['points'][-1], [200, 350])
        self.assertTrue(page.is_visible('#zoomReset'))
        self.assertFalse(page.is_visible('#helpButton'))
        page.context.close()

    def test_canvas_follows_pixel_density_changes(self):
        page = self.phone('/draw/')
        page.wait_for_function('window.SketchSaathi && SketchSaathi.ready')
        page.evaluate("Object.defineProperty(window, 'devicePixelRatio', { get: () => 3, configurable: true })")
        page.evaluate("""(() => {
            const c = document.querySelector('canvas');
            const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
                pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: true }));
            fire('pointerdown', 100, 200); fire('pointermove', 120, 220); fire('pointermove', 140, 240); fire('pointerup', 140, 240);
        })()""")
        page.wait_for_function("document.querySelector('canvas').width === document.querySelector('canvas').clientWidth * 3")
        stroke = page.evaluate('SketchSaathi.canvas.getElements()[0]')
        self.assertEqual(stroke['points'][0], [100, 200])
        drawn = page.evaluate("""(() => {
            const c = document.querySelector('canvas');
            return c.getContext('2d').getImageData(120 * 3, 220 * 3, 1, 1).data[3];
        })()""")
        self.assertGreater(drawn, 0)
        page.context.close()

    def test_new_shape_is_selected_unless_tool_is_locked(self):
        self.page.keyboard.press('o')
        self.drag((300, 300), (420, 380))
        self.assertIn('active', self.page.get_attribute('[data-tool=select]', 'class'))
        self.assertEqual(self.page.evaluate('SketchSaathi.canvas.getSelectedList().map(e => e.type)'), ['ellipse'])
        self.shot('28-selected-after-drawing')

        self.page.keyboard.press('p')
        self.drag((500, 300), (560, 340))
        self.assertIn('active', self.page.get_attribute('[data-tool=pen]', 'class'))

        self.page.keyboard.press('q')
        self.page.keyboard.press('r')
        self.drag((300, 450), (380, 500))
        self.drag((450, 450), (530, 500))
        self.assertEqual([e['type'] for e in self.elements()], ['ellipse', 'pen', 'rectangle', 'rectangle'])
        self.assertEqual(self.page.get_attribute('#toolLock', 'aria-pressed'), 'true')

    def no_native_pickers(self, page=None):
        (page or self.page).evaluate("window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined")

    def test_save_to_file_and_open_it_again(self):
        import json
        import tempfile

        self.no_native_pickers()
        self.page.keyboard.press('r')
        self.drag((300, 300), (400, 380))
        self.page.click('#addPage')
        self.page.wait_for_function("document.querySelectorAll('.tab').length === 2")
        self.page.keyboard.press('o')
        self.drag((500, 300), (600, 380))
        self.page.click('#menuButton')
        self.page.fill('#title', 'My plan')
        with self.page.expect_download() as download:
            self.page.keyboard.press('Control+s')                  # works while typing in the title box
        saved = download.value
        self.assertEqual(saved.suggested_filename, 'My plan.saathi')
        data = json.loads(Path(saved.path()).read_text(encoding='utf-8'))
        self.assertEqual((data['format'], data['title'], len(data['pages'])), ('sketchsaathi', 'My plan', 2))
        self.assertEqual([e['type'] for e in data['pages'][0]['elements']], ['rectangle'])
        self.assertEqual([e['type'] for e in data['pages'][1]['elements']], ['ellipse'])

        self.page.select_option('#boards', '')                     # start fresh (the menu is still open)
        self.assertEqual(self.elements(), [])
        self.page.click('#menuButton')
        with self.page.expect_file_chooser() as chooser:
            self.page.click('#openFile')
        chooser.value.set_files(saved.path())
        self.page.wait_for_function("document.querySelectorAll('.tab').length === 2")
        self.assertEqual(self.page.input_value('#title'), 'My plan')
        self.page.wait_for_function('SketchSaathi.canvas.getElements().length === 1')
        self.assertEqual(self.elements()[0]['type'], 'rectangle')

        with tempfile.NamedTemporaryFile('w', suffix='.saathi', delete=False, encoding='utf-8') as bad:
            bad.write('{"hello": "world"}')
        self.page.click('#menuButton')
        with self.page.expect_file_chooser() as chooser:
            self.page.click('#openFile')
        chooser.value.set_files(bad.name)
        self.page.wait_for_selector('.toast.error')
        self.assertIn('not a SketchSaathi drawing', self.page.inner_text('.toast.error'))
        os.unlink(bad.name)

    def test_boards_menu_switch_rename_and_new(self):
        options = lambda: self.page.evaluate("[...document.querySelectorAll('#boards option')].map(o => o.textContent)")

        self.page.keyboard.press('r')
        self.drag((300, 300), (400, 380))
        self.page.click('#menuButton')
        self.page.fill('#title', 'First')
        self.page.press('#title', 'Enter')
        self.page.click('#addPage')                                 # saves the board under its title
        self.page.wait_for_function("document.querySelectorAll('.tab').length === 2")
        self.page.wait_for_function("[...document.querySelectorAll('#boards option')].some(o => o.textContent === 'First')")

        self.page.click('#menuButton')
        self.page.select_option('#boards', '')                      # New board
        self.assertEqual(self.elements(), [])
        self.assertEqual(self.page.input_value('#title'), 'Untitled')
        self.page.keyboard.press('Escape')
        self.page.keyboard.press('o')
        self.drag((500, 300), (600, 380))
        self.page.click('#addPage')
        self.page.wait_for_function("document.querySelectorAll('.tab').length === 2")
        self.assertEqual(sorted(options()), ['First', 'New board', 'Untitled'])

        first = self.page.evaluate("[...document.querySelectorAll('#boards option')].find(o => o.textContent === 'First').value")
        self.page.click('#menuButton')
        self.page.select_option('#boards', first)                   # switch back to the first board
        self.page.wait_for_function("document.querySelector('#title').value === 'First'")
        self.page.wait_for_function('SketchSaathi.canvas.getElements().length === 1')
        self.assertEqual(self.elements()[0]['type'], 'rectangle')

        self.page.click('#menuButton')
        self.page.fill('#title', 'First renamed')
        self.page.press('#title', 'Enter')                          # renaming saves straight away
        self.page.wait_for_function("[...document.querySelectorAll('#boards option')].some(o => o.textContent === 'First renamed')")
        self.page.reload()
        self.page.wait_for_function('window.SketchSaathi && SketchSaathi.ready')
        self.page.wait_for_function("document.querySelector('#title').value === 'First renamed'")
