"""
test_helpers.py — Tests for the helpers module.

Tests: test role detection via filename pattern matching.
"""

from utils.helpers import format_greeting, validate_input


def test_format_greeting():
    assert format_greeting("Alice") == "Hello, Alice!"


def test_validate_input():
    assert validate_input("hello") == "hello"


def test_validate_input_strips_special():
    assert validate_input("he!!o") == "heo"
