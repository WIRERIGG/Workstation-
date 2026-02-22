#!/usr/bin/env python3
"""Debug script to check the Pydantic AI result structure."""

import sys
import os
import asyncio

# Add the current directory to Python path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

from agent import clang_tidy_agent
from dependencies import create_dependencies

async def debug_result():
    """Debug what attributes are available on the agent result."""
    deps = create_dependencies("debug")
    
    try:
        result = await clang_tidy_agent.run(
            "Hello, what attributes do you have?",
            deps=deps
        )
        
        print("Result type:", type(result))
        print("Result attributes:", dir(result))
        
        # Try different common attribute names
        for attr in ['data', 'content', 'response', 'message', 'text', 'value']:
            if hasattr(result, attr):
                print(f"✅ {attr}: {getattr(result, attr)}")
            else:
                print(f"❌ {attr}: not found")
                
    finally:
        deps.db_connection.close()

if __name__ == "__main__":
    asyncio.run(debug_result())