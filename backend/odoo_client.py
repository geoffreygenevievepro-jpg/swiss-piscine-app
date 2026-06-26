"""
Odoo JSON-RPC Client for Odoo SaaS 19.2
Communicates with Odoo server using JSON-RPC protocol

Features:
- Secure read-only mode by default
- Comprehensive audit logging for all operations
- Protected write/create/delete operations
"""

import os
import json
import random
import time
import threading
import requests
import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin
from dotenv import load_dotenv
from datetime import datetime

# --- Cache de lecture court (anti rate-limit Odoo 429) ---------------------
# Mémorise le résultat des lectures (search_read/read/search...) pendant un
# court instant, partagé entre les clients RO/RW. Toute ÉCRITURE sur un modèle
# invalide le cache de lecture de ce modèle → la fraîcheur du temps réel
# (pointage, etc.) est préservée juste après une action de l'utilisateur.
_READ_METHODS = {
    "search_read", "read", "search", "search_count",
    "read_group", "name_search", "name_get", "fields_get",
}
_CACHE_TTL = 20.0  # secondes
_cache_lock = threading.Lock()
_cache_store: dict = {}        # key -> (expires_at, result)
_cache_model_keys: dict = {}   # model -> set(keys)


def _cache_key(model, method, args, kwargs):
    return (model, method,
            json.dumps(args, default=str, sort_keys=True),
            json.dumps(kwargs, default=str, sort_keys=True))


def _cache_lookup(key):
    now = time.time()
    with _cache_lock:
        ent = _cache_store.get(key)
        if ent and ent[0] > now:
            return True, ent[1]
        if ent:
            _cache_store.pop(key, None)
    return False, None


def _cache_put(model, key, result):
    with _cache_lock:
        _cache_store[key] = (time.time() + _CACHE_TTL, result)
        _cache_model_keys.setdefault(model, set()).add(key)


def _cache_invalidate(model):
    with _cache_lock:
        for k in _cache_model_keys.pop(model, ()):
            _cache_store.pop(k, None)

_SENSITIVE_FIELDS = {"email", "phone", "mobile", "street", "zip", "password", "name"}

def _mask_log(values: dict) -> dict:
    """Masque les champs PII pour les logs d'audit."""
    return {k: ("***" if k in _SENSITIVE_FIELDS else v) for k, v in values.items()}

# Load environment variables from .env file
load_dotenv()

# Configure audit logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('odoo_audit.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('OdooClient')


class OdooClient:
    """
    JSON-RPC client for Odoo SaaS 19.2
    
    Security Features:
    - Read-only mode by default (readonly=True)
    - Comprehensive audit logging of all operations
    - Protection against accidental data modification
    
    Example:
        # Read-only mode (default)
        client = OdooClient()
        client.authenticate()
        partners = client.execute_kw('res.partner', 'search_read', [])
        
        # With write permissions (explicitly enabled)
        client = OdooClient(readonly=False)
        client.authenticate()
        # Can now use write(), create(), unlink()
    """
    
    def __init__(
        self,
        url: Optional[str] = None,
        database: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        readonly: bool = True,
    ):
        """
        Initialize Odoo JSON-RPC client
        
        Args:
            url: Odoo server URL (e.g., https://mydomain.odoo.com)
            database: Database name
            username: User email/login
            password: User password
            readonly: If True, prevents write/create/unlink operations (default: True)
        """
        self.url = url or os.getenv("ODOO_URL", "").rstrip("/")
        self.database = database or os.getenv("ODOO_DATABASE")
        self.username = username or os.getenv("ODOO_USERNAME")
        self.password = password or os.getenv("ODOO_PASSWORD")
        self.uid = None
        self.session = requests.Session()
        self.readonly = readonly
        
        # Set up JSON-RPC endpoint
        self.json_rpc_endpoint = urljoin(self.url, "/jsonrpc")
        
        if not all([self.url, self.database, self.username, self.password]):
            raise ValueError(
                "Missing Odoo configuration. Please set ODOO_URL, ODOO_DATABASE, "
                "ODOO_USERNAME, and ODOO_PASSWORD in .env file"
            )
        
        mode = "READ-ONLY" if self.readonly else "READ-WRITE"
        logger.info(f"OdooClient initialized - Mode: {mode} - URL: {self.url}")
    
    def _call(self, method: str, params: Dict[str, Any]) -> Any:
        """
        Make a JSON-RPC 2.0 call to Odoo server
        
        Args:
            method: RPC method name (e.g., 'call', 'execute', 'execute_kw')
            params: Method parameters
            
        Returns:
            Response result or raises exception on error
            
        Raises:
            Exception: If RPC call returns an error
        """
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": random.randint(1, 2**31 - 1),
        }
        
        # Audit logging
        service = params.get("service", "unknown")
        rpc_method = params.get("method", "unknown")
        logger.debug(f"RPC Call: {service}.{rpc_method}")
        
        # Jusqu'à 2 retries sur 429 (Odoo rate-limit) avec backoff court.
        for attempt in range(3):
            try:
                response = self.session.post(
                    self.json_rpc_endpoint,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                    timeout=30,
                )
            except requests.exceptions.RequestException as e:
                logger.error(f"HTTP Error: {str(e)}")
                raise Exception(f"HTTP Error: {str(e)}")

            if response.status_code == 429 and attempt < 2:
                time.sleep(0.5 * (attempt + 1))  # 0.5s puis 1.0s
                continue

            try:
                response.raise_for_status()
            except requests.exceptions.RequestException as e:
                logger.error(f"HTTP Error: {str(e)}")
                raise Exception(f"HTTP Error: {str(e)}")

            result = response.json()

            if "error" in result and result["error"] is not None:
                error = result["error"]
                error_message = error.get("message", "Unknown error")
                error_data = error.get("data", {})
                logger.error(f"RPC Error: {service}.{rpc_method} - {error_message}")
                raise Exception(f"Odoo RPC Error: {error_message}\n{error_data}")

            logger.debug(f"RPC Success: {service}.{rpc_method}")
            return result.get("result")

        # 429 persistant après retries
        raise Exception("HTTP Error: 429 Too Many Requests (Odoo, après retries)")
    
    def authenticate(self) -> int:
        """
        Authenticate to Odoo server and get session UID
        
        Returns:
            User ID (uid) if authentication succeeds
            
        Raises:
            Exception: If authentication fails
        """
        params = {
            "service": "common",
            "method": "authenticate",
            "args": [self.database, self.username, self.password, {}],
        }
        
        try:
            logger.info(f"Attempting authentication for user: {self.username}")
            self.uid = self._call("call", params)
            
            if not self.uid:
                logger.error(f"Authentication failed for user: {self.username}")
                raise Exception("Authentication failed: Invalid credentials")
            
            logger.info(f"[AUTHENTICATED] Successfully authenticated - UID: {self.uid} - Database: {self.database}")
            return self.uid
            
        except Exception as e:
            logger.error(f"Authentication error: {str(e)}")
            raise
    
    def execute_kw(
        self,
        model: str,
        method: str,
        args: Optional[List[Any]] = None,
        kwargs: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """
        Execute a method on an Odoo model
        
        Args:
            model: Model name (e.g., 'res.partner')
            method: Method name (e.g., 'search', 'read', 'create', 'write')
            args: Positional arguments
            kwargs: Keyword arguments
            
        Returns:
            Method result
            
        Example:
            # Search for partners with name containing "John"
            partners = client.execute_kw('res.partner', 'search', [[['name', 'ilike', 'John']]])
            
            # Read partner fields
            data = client.execute_kw('res.partner', 'read', [partners, ['id', 'name', 'email']])
            
            # Create a new partner
            new_id = client.execute_kw('res.partner', 'create', [{'name': 'New Company', 'email': 'test@example.com'}])
        """
        if not self.uid:
            raise Exception("Not authenticated. Call authenticate() first.")
        
        args = args or []
        kwargs = kwargs or {}

        # Lecture : servir depuis le cache court si disponible.
        cache_key = None
        if method in _READ_METHODS:
            cache_key = _cache_key(model, method, args, kwargs)
            hit, val = _cache_lookup(cache_key)
            if hit:
                return val

        params = {
            "service": "object",
            "method": "execute_kw",
            "args": [self.database, self.uid, self.password, model, method, args, kwargs],
        }
        result = self._call("call", params)

        if method in _READ_METHODS:
            _cache_put(model, cache_key, result)
        else:
            # Écriture (create/write/unlink/…) → invalider le cache de lecture
            # de ce modèle pour garder la fraîcheur juste après l'action.
            _cache_invalidate(model)
        return result
    
    def search(
        self,
        model: str,
        domain: Optional[List] = None,
        offset: int = 0,
        limit: int = 0,
        order: str = "",
    ) -> List[int]:
        """
        Search for records in a model
        
        Args:
            model: Model name
            domain: Search domain (list of conditions)
            offset: Offset for results
            limit: Limit number of results (0 = no limit)
            order: Order by clause
            
        Returns:
            List of record IDs
        """
        domain = domain or []
        args = [domain]
        kwargs = {}
        
        if offset:
            kwargs["offset"] = offset
        if limit:
            kwargs["limit"] = limit
        if order:
            kwargs["order"] = order
        
        logger.debug(f"SEARCH: {model} - Domain: {domain} - Limit: {limit}")
        results = self.execute_kw(model, "search", args, kwargs)
        logger.debug(f"Found {len(results)} records in {model}")
        return results
    
    def read(self, model: str, ids: List[int], fields: Optional[List[str]] = None) -> List[Dict]:
        """
        Read records from a model
        
        Args:
            model: Model name
            ids: List of record IDs
            fields: Fields to read (empty list = all fields)
            
        Returns:
            List of record dictionaries
        """
        fields = fields or []
        logger.debug(f"READ: {model} - IDs: {ids[:5]}{'...' if len(ids) > 5 else ''} - Fields: {fields}")
        return self.execute_kw(model, "read", [ids, fields])
    
    def search_read(
        self,
        model: str,
        domain: Optional[List] = None,
        fields: Optional[List[str]] = None,
        offset: int = 0,
        limit: int = 0,
        order: str = "",
    ) -> List[Dict]:
        """
        Search and read records in one call
        
        Args:
            model: Model name
            domain: Search domain
            fields: Fields to read
            offset: Offset for results
            limit: Limit number of results
            order: Order by clause
            
        Returns:
            List of record dictionaries
        """
        domain = domain or []
        fields = fields or []
        args = [domain]
        kwargs = {"fields": fields}
        
        if offset:
            kwargs["offset"] = offset
        if limit:
            kwargs["limit"] = limit
        if order:
            kwargs["order"] = order
        
        logger.debug(f"SEARCH_READ: {model} - Domain: {domain} - Fields: {fields}")
        results = self.execute_kw(model, "search_read", args, kwargs)
        logger.debug(f"Found {len(results)} records in {model}")
        return results
    
    def create(self, model: str, values: Dict[str, Any]) -> int:
        """
        Create a new record
        
        Args:
            model: Model name
            values: Dictionary of field values
            
        Returns:
            ID of created record
            
        Raises:
            Exception: If readonly mode is enabled
        """
        if self.readonly:
            error_msg = f"BLOCKED: Cannot create on model '{model}' - READ-ONLY mode enabled"
            logger.warning(error_msg)
            raise Exception(error_msg)
        
        logger.warning(f"CREATE: {model} - Data: {_mask_log(values)}")
        new_id = self.execute_kw(model, "create", [values])
        logger.info(f"[CREATED] Record ID {new_id} on model {model}")
        return new_id
    
    def write(self, model: str, ids: List[int], values: Dict[str, Any]) -> bool:
        """
        Update records
        
        Args:
            model: Model name
            ids: List of record IDs to update
            values: Dictionary of field values to update
            
        Returns:
            True if successful
            
        Raises:
            Exception: If readonly mode is enabled
        """
        if self.readonly:
            error_msg = f"BLOCKED: Cannot update {len(ids)} records on model '{model}' - READ-ONLY mode enabled"
            logger.warning(error_msg)
            raise Exception(error_msg)
        
        logger.warning(f"WRITE: {model} - IDs: {ids} - Data: {_mask_log(values)}")
        result = self.execute_kw(model, "write", [ids, values])
        logger.info(f"[UPDATED] {len(ids)} records on model {model}")
        return result
    
    def unlink(self, model: str, ids: List[int]) -> bool:
        """
        Delete records
        
        Args:
            model: Model name
            ids: List of record IDs to delete
            
        Returns:
            True if successful
            
        Raises:
            Exception: If readonly mode is enabled
        """
        if self.readonly:
            error_msg = f"BLOCKED: Cannot delete {len(ids)} records from model '{model}' - READ-ONLY mode enabled"
            logger.warning(error_msg)
            raise Exception(error_msg)
        
        logger.warning(f"DELETE: {model} - IDs: {ids} ({len(ids)} enregistrement(s))")
        result = self.execute_kw(model, "unlink", [ids])
        logger.info(f"[DELETED] {len(ids)} records from model {model}")
        return result
    
    def get_fields(self, model: str, attributes: Optional[List[str]] = None) -> Dict:
        """
        Get field information for a model
        
        Args:
            model: Model name
            attributes: Specific attributes to retrieve
            
        Returns:
            Dictionary of field definitions
        """
        kwargs = {}
        if attributes:
            kwargs["attributes"] = attributes
        
        return self.execute_kw(model, "fields_get", [], kwargs)
    
    def close(self):
        """Close the session"""
        self.session.close()
    
    def __enter__(self):
        """Context manager entry"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        self.close()


def main():
    """Example usage of OdooClient"""
    try:
        # Initialize in read-only mode (default - SAFE)
        print("=" * 60)
        print("READ-ONLY MODE (DEFAULT)")
        print("=" * 60)
        with OdooClient(readonly=True) as client:
            client.authenticate()
            
            # Example 1: Search for partners
            print("\n--- Searching for partners ---")
            partner_ids = client.search("res.partner", limit=5)
            print(f"Found {len(partner_ids)} partners: {partner_ids}")
            
            # Example 2: Read partner details
            if partner_ids:
                print("\n--- Reading partner details ---")
                partners = client.read(
                    "res.partner",
                    partner_ids,
                    ["id", "name", "email", "phone"]
                )
                for partner in partners:
                    print(f"  {partner['name']} ({partner['email']})")
            
            # Example 3: Search and read in one call
            print("\n--- Search and read companies ---")
            companies = client.search_read(
                "res.company",
                fields=["id", "name"],
                limit=5
            )
            for company in companies:
                print(f"  {company['name']}")
        
        # Attempting write in read-only mode
        print("\n" + "=" * 60)
        print("ATTEMPTING WRITE IN READ-ONLY MODE")
        print("=" * 60)
        with OdooClient(readonly=True) as client:
            client.authenticate()
            try:
                client.write("res.partner", [1], {"name": "Test"})
            except Exception as e:
                print(f"[BLOCKED] {e}")
        
        # Example of read-write mode (REQUIRES EXPLICIT ENABLE)
        print("\n" + "=" * 60)
        print("READ-WRITE MODE (MUST BE EXPLICITLY ENABLED)")
        print("=" * 60)
        print("Note: To enable write mode, initialize with: OdooClient(readonly=False)")
        print("      This is disabled by default for safety reasons.")
    
    except Exception as e:
        logger.error(f"Error: {str(e)}", exc_info=True)


if __name__ == "__main__":
    main()

