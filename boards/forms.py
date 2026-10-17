from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.contrib.auth.models import User


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
    autocomplete = {'username': 'username', 'password': 'current-password'}
    remember = forms.BooleanField(label='Keep me signed in', required=False, initial=True)


class SignupForm(BootstrapFormMixin, UserCreationForm):
    autocomplete = {'username': 'username', 'email': 'email', 'password1': 'new-password', 'password2': 'new-password'}

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ['username', 'email']
        labels = {'email': 'Email (optional)'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['username'].help_text = 'Letters, digits and @ . + - _ only.'
        self.fields['password1'].help_text = ''
        self.fields['password2'].label = 'Confirm password'
        self.fields['password2'].help_text = ''
        self.fields['password2'].widget.attrs['placeholder'] = 'Confirm password'
