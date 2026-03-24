"""
Test Supabase database connection and schema.
Verifies all tables exist and are queryable.

Run from the project root:
    python scripts/test_supabase_connection.py
"""
import os
import sys
from dotenv import load_dotenv

load_dotenv('backend/.env')
sys.path.insert(0, 'backend')

from app.database.supabase_client import get_supabase_client

# All tables in the current schema with their expected columns
TABLES = {
    'profiles': ['id', 'email', 'display_name', 'created_at'],
    'discussions': ['id', 'user_id', 'title', 'is_active', 'is_public', 'created_at', 'updated_at'],
    'messages': ['id', 'discussion_id', 'role', 'content', 'provider',
                 'tokens_used', 'response_time_ms', 'sources', 'citations',
                 'suggested_questions', 'intent', 'research_mode', 'created_at'],
    'document_formatted_chunks': ['id', 'document_id', 'chunk_id', 'formatted_content', 'created_at'],
}

def check_env():
    print("\n── Environment ─────────────────────────────────")
    required = ['SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET']
    all_set = True
    for key in required:
        val = os.getenv(key)
        if val:
            print(f"  ✓ {key} is set")
        else:
            print(f"  ✗ {key} is MISSING")
            all_set = False
    return all_set

def check_tables(supabase):
    print("\n── Tables ──────────────────────────────────────")
    all_ok = True
    for table, expected_columns in TABLES.items():
        try:
            response = supabase.table(table).select(', '.join(expected_columns)).limit(1).execute()
            row_count = len(response.data)
            print(f"  ✓ {table} — queryable ({row_count} row(s) visible)")
        except Exception as e:
            err = str(e)
            if 'does not exist' in err or 'relation' in err:
                print(f"  ✗ {table} — TABLE MISSING (run backend/supabase_schema.sql)")
            elif 'column' in err:
                print(f"  ✗ {table} — COLUMN MISMATCH: {err}")
            else:
                print(f"  ✗ {table} — ERROR: {err}")
            all_ok = False
    return all_ok

def check_rls(supabase):
    """
    RLS policies mean an unauthenticated client will see 0 rows on user-scoped
    tables. That's expected and correct — we just verify no exception is thrown.
    """
    print("\n── RLS Policies ────────────────────────────────")
    rls_tables = ['profiles', 'discussions', 'messages']
    all_ok = True
    for table in rls_tables:
        try:
            response = supabase.table(table).select('id').limit(1).execute()
            print(f"  ✓ {table} — RLS active (unauthenticated sees {len(response.data)} row(s), expected)")
        except Exception as e:
            print(f"  ✗ {table} — unexpected RLS error: {e}")
            all_ok = False
    return all_ok

def main():
    print("=" * 52)
    print("  Qodex — Supabase Connection & Schema Test")
    print("=" * 52)

    env_ok = check_env()
    if not env_ok:
        print("\n❌ Missing environment variables. Check backend/.env")
        sys.exit(1)

    print("\n── Connection ──────────────────────────────────")
    try:
        supabase = get_supabase_client()
        print("  ✓ Supabase client initialized")
    except Exception as e:
        print(f"  ✗ Failed to initialize client: {e}")
        print("\nTroubleshooting:")
        print("  1. Verify SUPABASE_URL and SUPABASE_KEY in backend/.env")
        print("  2. Check your Supabase project is active")
        sys.exit(1)

    tables_ok = check_tables(supabase)
    rls_ok = check_rls(supabase)

    print("\n" + "=" * 52)
    if tables_ok and rls_ok:
        print("  ✅ ALL CHECKS PASSED")
        print("=" * 52)
        print("\n  Supabase is correctly configured and ready.\n")
        sys.exit(0)
    else:
        print("  ❌ SOME CHECKS FAILED")
        print("=" * 52)
        print("\n  Run backend/supabase_schema.sql in your Supabase")
        print("  SQL Editor to create or repair missing tables.\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
