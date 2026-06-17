"""
codekavi.limiter — Slowapi Limiter shared instance.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

# Configure rate limiting based on remote IP
limiter = Limiter(key_func=get_remote_address)
