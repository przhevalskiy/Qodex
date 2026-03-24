"""
Test Supabase database connection
Run this to verify your Supabase setup is working
"""
import os
import sys
from dotenv import load_dotenv

# Load environment variables
load_dotenv('backend/.env')

sys.path.insert(0, 'backend')

from app.database.supabase_client import get_supabase_client

def test_connection():
    print("=" * 60)
    print("Testing Supabase Connection")
    print("=" * 60)

    try:
        # Get Supabase client
        supabase = get_supabase_client()
        print("✓ Supabase client initialized successfully\n")

        # Test connection by querying users table
        print("Testing database query...")
        response = supabase.table('users').select('*').limit(1).execute()
        print(f"✓ Successfully queried 'users' table")
        print(f"  Found {len(response.data)} users\n")

        # Test discussions table
        print("Testing discussions table...")
        response = supabase.table('discussions').select('*').limit(1).execute()
        print(f"✓ Successfully queried 'discussions' table")
        print(f"  Found {len(response.data)} discussions\n")

        # Test messages table
        print("Testing messages table...")
        response = supabase.table('messages').select('*').limit(1).execute()
        print(f"✓ Successfully queried 'messages' table")
        print(f"  Found {len(response.data)} messages\n")

        print("=" * 60)
        print("✅ ALL TESTS PASSED!")
        print("=" * 60)
        print("\nYour Supabase database is set up correctly and ready to use.")
        return True

    except Exception as e:
        print(f"\n❌ ERROR: {str(e)}")
        print("\nTroubleshooting:")
        print("1. Check that SUPABASE_URL and SUPABASE_KEY are set in backend/.env")
        print("2. Verify you ran the database schema SQL in Supabase SQL Editor")
        print("3. Check that your Supabase project is active and running")
        return False

if __name__ == "__main__":
    success = test_connection()
    sys.exit(0 if success else 1)
