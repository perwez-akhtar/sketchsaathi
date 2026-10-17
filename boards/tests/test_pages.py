from django.contrib.auth.models import User
from django.test import TestCase


class HomePageTests(TestCase):
    def test_home_shows_landing_page_to_visitors(self):
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        self.assertTemplateUsed(res, 'boards/landing.html')
        self.assertContains(res, 'bootstrap@5.3.3')
        self.assertContains(res, 'href="/signup/"')
        self.assertNotContains(res, '<canvas')

    def test_home_serves_canvas_when_logged_in(self):
        self.client.force_login(User.objects.create_user('alice', password='pw-12345-x'))
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, '<canvas')
        self.assertContains(res, 'boards/js/collab.js')
        self.assertContains(res, 'boards/js/presence.js')
        for tool in ('select', 'text', 'diamond', 'arrow', 'eraser'):
            self.assertContains(res, f'data-tool="{tool}"')
        self.assertContains(res, 'alice')


class ShareLinkTests(TestCase):
    def test_share_link_serves_the_app(self):
        self.client.force_login(User.objects.create_user('bob', password='pw-12345-x'))
        res = self.client.get('/b/6fe3768b-4163-4845-9f9a-3253f4231ab8/')
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, '<canvas')

    def test_share_link_needs_login(self):
        res = self.client.get('/b/6fe3768b-4163-4845-9f9a-3253f4231ab8/')
        self.assertRedirects(res, '/login/?next=/b/6fe3768b-4163-4845-9f9a-3253f4231ab8/')


class AuthPageTests(TestCase):
    def test_signup_creates_user_and_logs_in(self):
        res = self.client.post('/signup/', {
            'username': 'newbie', 'email': 'n@example.com',
            'password1': 'Str0ng-pass-99', 'password2': 'Str0ng-pass-99',
        })
        self.assertRedirects(res, '/')
        self.assertTrue(User.objects.filter(username='newbie').exists())
        self.assertEqual(self.client.get('/').status_code, 200)

    def test_auth_pages_use_bootstrap_fields(self):
        for url in ('/login/', '/signup/'):
            res = self.client.get(url)
            self.assertContains(res, 'class="form-control"')
        res = self.client.post('/login/', {'username': 'nobody', 'password': 'wrong'})
        self.assertContains(res, 'alert-danger')
        res = self.client.post('/signup/', {'username': 'x', 'password1': 'Str0ng-pass-99', 'password2': 'other'})
        self.assertContains(res, 'is-invalid')

    def test_login_and_logout(self):
        User.objects.create_user('alice', password='pw-12345-x')
        res = self.client.post('/login/', {'username': 'alice', 'password': 'pw-12345-x'})
        self.assertRedirects(res, '/')
        res = self.client.post('/logout/')
        self.assertRedirects(res, '/')
        self.assertTemplateUsed(self.client.get('/'), 'boards/landing.html')


class GuestModeTests(TestCase):
    def test_guest_editor_opens_without_login(self):
        res = self.client.get('/draw/')
        self.assertEqual(res.status_code, 200)
        self.assertContains(res, 'data-guest="1"')
        self.assertContains(res, 'boards/js/local-store.js')
        self.assertContains(res, 'Sign up to save')

    def test_signed_in_users_go_to_their_boards(self):
        self.client.force_login(User.objects.create_user('alice', password='pw-12345-x'))
        self.assertRedirects(self.client.get('/draw/'), '/')
        self.assertNotContains(self.client.get('/'), 'data-guest')


class RememberMeTests(TestCase):
    def setUp(self):
        User.objects.create_user('alice', password='pw-12345-x')

    def test_session_ends_with_browser_unless_remembered(self):
        self.client.post('/login/', {'username': 'alice', 'password': 'pw-12345-x'})
        self.assertTrue(self.client.session.get_expire_at_browser_close())
        self.client.post('/logout/')
        self.client.post('/login/', {'username': 'alice', 'password': 'pw-12345-x', 'remember': 'on'})
        self.assertFalse(self.client.session.get_expire_at_browser_close())
