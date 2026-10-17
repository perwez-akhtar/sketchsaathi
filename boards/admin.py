from django.contrib import admin

from .models import Board, Page


class PageInline(admin.TabularInline):
    model = Page
    fields = ('name', 'position', 'background', 'updated_at')
    readonly_fields = ('updated_at',)
    extra = 0


@admin.register(Board)
class BoardAdmin(admin.ModelAdmin):
    list_display = ('title', 'owner', 'updated_at')
    list_filter = ('created_at',)
    search_fields = ('title', 'owner__username')
    readonly_fields = ('uuid', 'created_at', 'updated_at')
    inlines = [PageInline]
