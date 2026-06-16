"""
Mock spaCy at sys.modules level before server.py is imported.
This lets the tests run without any downloaded NLP models.
"""
import sys
import os
from unittest.mock import MagicMock
import pytest

_mock_nlp = MagicMock()
_mock_nlp.vocab = MagicMock()

_mock_spacy = MagicMock()
_mock_spacy.load.return_value = _mock_nlp

sys.modules.setdefault("spacy", _mock_spacy)
sys.modules.setdefault("spacy.matcher", MagicMock())
sys.modules.setdefault("spacy.language", MagicMock())

# Make `import server` resolve to docker/spacy/server.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture(autouse=True)
def _clear_ner_cache():
    """Reset the module-level NER model cache between tests."""
    import server as srv
    srv._ner_cache.clear()
    yield
    srv._ner_cache.clear()


@pytest.fixture
def mock_nlp():
    """The mock NLP pipeline. Tests configure .return_value.ents to control output."""
    return _mock_nlp
