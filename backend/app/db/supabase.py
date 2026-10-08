from supabase import create_client, Client
from app.core.config import settings

def get_supabase_client(token: str | None = None) -> Client:
    """
    Creates a Supabase client. 
    If token is provided, initializes it as the authenticated user.
    """
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    if token:
        # Override the Authorization header to make requests on behalf of the user
        client.postgrest.auth(token)
    return client
