"""Test configuration. Runs before any test module is imported."""
import os

# Every login hashes or verifies a password; production's bcrypt cost (12) makes the suite many times slower.
os.environ.setdefault("BCRYPT_ROUNDS", "4")
