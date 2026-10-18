from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.contrib.auth.models import User
from django.db.models import Q

from .disposable import is_disposable


class BootstrapFormMixin:
    autocomplete = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name, field in self.fields.items():
            attrs = field.widget.attrs
            if isinstance(field.widget, forms.CheckboxInput):
                attrs['class'] = 'form-check-input'
                continue
            attrs['class'] = ' '.join(attrs.get('class', '').split() + ['form-control'])
            attrs.setdefault('placeholder', field.label)
            if name in self.autocomplete:
                attrs['autocomplete'] = self.autocomplete[name]

    def full_clean(self):
        # mark fields with errors so Bootstrap highlights them
        super().full_clean()
        for name in self.errors:
            if name in self.fields:
                widget = self.fields[name].widget
                if 'is-invalid' not in widget.attrs.get('class', ''):
                    widget.attrs['class'] = (widget.attrs.get('class', '') + ' is-invalid').strip()


class LoginForm(BootstrapFormMixin, AuthenticationForm):
    autocomplete = {'username': 'email', 'password': 'current-password'}
    remember = forms.BooleanField(label='Keep me signed in', required=False, initial=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['username'].label = 'Email'
        self.fields['username'].widget.attrs['placeholder'] = 'Email'

    def clean(self):
        # accounts are keyed by email; older accounts can still type their old username
        typed = (self.cleaned_data.get('username') or '').strip()
        if '@' in typed:
            found = list(User.objects.filter(email__iexact=typed).values_list('username', flat=True)[:2])
            if len(found) == 1:
                self.cleaned_data['username'] = found[0]
        return super().clean()


class SignupForm(BootstrapFormMixin, UserCreationForm):
    autocomplete = {'email': 'email', 'password1': 'new-password', 'password2': 'new-password'}

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ['email']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['email'].required = True
        self.fields['email'].label = 'Email'
        self.fields['email'].widget.attrs['placeholder'] = 'Email'
        self.fields['password1'].help_text = ''
        self.fields['password2'].label = 'Confirm password'
        self.fields['password2'].help_text = ''
        self.fields['password2'].widget.attrs['placeholder'] = 'Confirm password'

    def clean_email(self):
        email = self.cleaned_data['email'].strip().lower()
        if len(email) > 150:
            raise forms.ValidationError('That email address is too long.')
        if is_disposable(email):
            raise forms.ValidationError('Temporary email addresses are not allowed. Please use your real email.')
        if User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).exists():
            raise forms.ValidationError('An account with this email already exists.')
        self.instance.username = email
        return email
