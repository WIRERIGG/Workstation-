#!/usr/bin/env python3
"""Entry point script to run the Clang-Tidy AI Agent CLI."""

import sys
import os

# Add the current directory to Python path so we can import our modules
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

# Now import and run the CLI
from cli import main

if __name__ == "__main__":
    main()