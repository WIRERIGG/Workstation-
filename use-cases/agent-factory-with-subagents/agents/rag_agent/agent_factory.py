"""
RAG Agent Factory with comprehensive validation and knowledge management focus.

This factory creates validated RAG agents with specialized validation rules
for document ingestion, embedding generation, and retrieval operations.
"""

import asyncio
import json
import logging
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Dict, List, Any, Optional

# Import the template factory
import sys
sys.path.append(str(Path(__file__).parent.parent.parent.parent.parent / ".claude" / "agents"))
from agent_factory_template import (
    AgentFactory, AgentFactoryConfig, ValidationLevel, ValidationResult,
    InputValidator, OutputValidator, BackendValidator, ValidatedAgent
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RAGAgentType(str, Enum):
    """Types of RAG agents."""
    RETRIEVER = "retriever"           # Document retrieval specialist
    EMBEDDER = "embedder"            # Embedding generation expert
    CHUNKER = "chunker"              # Document chunking specialist
    INDEXER = "indexer"              # Index management expert
    QUERY_PROCESSOR = "query_processor" # Query processing and enhancement


class RAGValidationLevel(str, Enum):
    """RAG-specific validation levels."""
    ENTERPRISE = "enterprise"        # Maximum validation for production
    PRODUCTION = "production"        # Standard production validation
    DEVELOPMENT = "development"      # Development-friendly validation
    EXPERIMENTAL = "experimental"   # Minimal validation for research


class RAGAgentConfig(AgentFactoryConfig):
    """Extended configuration for RAG agents."""

    agent_type: RAGAgentType
    embedding_model: str = Field(default="sentence-transformers/all-MiniLM-L6-v2")
    chunk_size: int = Field(default=512, ge=64, le=2048)
    chunk_overlap: int = Field(default=64, ge=0, le=512)
    vector_dimension: int = Field(default=384, ge=128, le=4096)
    enable_reranking: bool = Field(default=True)
    rag_validation_level: RAGValidationLevel = Field(default=RAGValidationLevel.PRODUCTION)


class RAGAgentFactory(AgentFactory):
    """Factory for creating specialized RAG agents."""

    def create_standard_rag_agents(self) -> Dict[str, ValidatedAgent]:
        """Create the standard set of RAG agents."""
        agents = {}

        # Retriever agent
        retriever_config = RAGAgentConfig(
            agent_name="rag_retriever",
            agent_type=RAGAgentType.RETRIEVER,
            system_prompt="You are a RAG document retrieval specialist.",
            validation_level=ValidationLevel.STRICT,
            rag_validation_level=RAGValidationLevel.PRODUCTION
        )
        agents["retriever"] = self.create_agent(retriever_config, lambda: "mock_model")

        return agents


# Module-level factory instance
_rag_factory: Optional[RAGAgentFactory] = None


def get_rag_factory() -> RAGAgentFactory:
    """Get or create the global RAG agent factory."""
    global _rag_factory
    if _rag_factory is None:
        _rag_factory = RAGAgentFactory()
    return _rag_factory