"""
main.py — Entry point for the sample fixture repo.

This file imports from utils.helpers and serves as the main entry point.
Used to test entry-point detection, import extraction, and dependency analysis.
"""

from utils.helpers import format_greeting, validate_input


def main():
    """Run the sample application."""
    name = validate_input("World")
    greeting = format_greeting(name)
    print(greeting)


if __name__ == "__main__":
    main()
