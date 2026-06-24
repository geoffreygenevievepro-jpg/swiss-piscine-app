"""Gestion d'erreurs : ne pas exposer les détails Odoo au client, mais les logger."""
import logging

from fastapi import HTTPException

logger = logging.getLogger("app.odoo")


def odoo_unavailable(exc: Exception) -> HTTPException:
    """Log l'erreur Odoo réelle côté serveur, renvoie un message générique au client."""
    logger.warning("Écriture Odoo échouée : %s", exc)
    return HTTPException(502, "Service momentanément indisponible, réessaie dans un instant.")
