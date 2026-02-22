"""
Agent Factory Template - Reusable factory pattern with validation for Pydantic AI agents.

Adapted for Notesnook TypeScript/React monorepo from RIGGWIRE-EA-LIVE template.

This template provides:
1. Factory-based agent creation
2. Comprehensive input/output validation
3. Backend state validation
4. Execution monitoring and history tracking
5. Health checks and statistics

Usage:
    from agent_factory_template import create_agent_factory, AgentFactoryConfig

    config = AgentFactoryConfig(
        agent_name="my_agent",
        system_prompt="...",
        validation_level=ValidationLevel.STRICT
    )

    factory = create_agent_factory(config)
    agent = factory.create_agent()
"""

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Dict, List, Any, Optional, Type, TypeVar, Generic, Protocol, Callable
import hashlib

from pydantic_ai import Agent, RunContext
from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic.types import conint, confloat


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

T = TypeVar('T', bound=BaseModel)


class ValidationLevel(str, Enum):
    """Validation strictness levels."""
    STRICT = "strict"      # Full validation with type checking
    MODERATE = "moderate"  # Basic validation
    MINIMAL = "minimal"    # Only critical validation


class ValidationResult(BaseModel):
    """Result of validation operations."""

    is_valid: bool
    validation_type: str
    timestamp: datetime = Field(default_factory=datetime.now)
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @property
    def has_warnings(self) -> bool:
        return len(self.warnings) > 0

    def add_error(self, error: str) -> None:
        """Add an error and mark as invalid."""
        self.errors.append(error)
        self.is_valid = False

    def add_warning(self, warning: str) -> None:
        """Add a warning without affecting validity."""
        self.warnings.append(warning)


class BaseValidator(BaseModel):
    """Base validator class for agent validation."""

    validation_level: ValidationLevel
    custom_rules: Dict[str, Callable] = Field(default_factory=dict)

    class Config:
        arbitrary_types_allowed = True

    async def validate(self, data: Any, context: Optional[Dict[str, Any]] = None) -> ValidationResult:
        """Override this method in subclasses."""
        raise NotImplementedError


class InputValidator(BaseValidator):
    """Validates agent inputs before processing."""

    async def validate_input(self, input_data: Any, schema: Optional[Type[BaseModel]] = None) -> ValidationResult:
        """Generic input validation."""
        result = ValidationResult(
            is_valid=True,
            validation_type="input_validation"
        )

        try:
            # If schema provided, validate against it
            if schema:
                if isinstance(input_data, dict):
                    schema(**input_data)
                elif not isinstance(input_data, schema):
                    result.add_error(f"Input does not match schema {schema.__name__}")

            # Apply custom validation rules
            for rule_name, rule_func in self.custom_rules.items():
                try:
                    if not await rule_func(input_data):
                        result.add_error(f"Custom rule '{rule_name}' failed")
                except Exception as e:
                    result.add_warning(f"Custom rule '{rule_name}' raised exception: {str(e)}")

            # Add metadata
            result.metadata["input_type"] = type(input_data).__name__
            if hasattr(input_data, '__len__'):
                result.metadata["input_size"] = len(input_data)

        except Exception as e:
            result.add_error(f"Input validation failed: {str(e)}")

        return result


class OutputValidator(BaseValidator):
    """Validates agent outputs after processing."""

    async def validate_output(self, output_data: Any, expected_schema: Optional[Type[BaseModel]] = None) -> ValidationResult:
        """Generic output validation."""
        result = ValidationResult(
            is_valid=True,
            validation_type="output_validation"
        )

        try:
            # Check for None or empty outputs
            if output_data is None:
                result.add_warning("Output is None")

            # Schema validation if provided
            if expected_schema and output_data is not None:
                if isinstance(output_data, dict):
                    expected_schema(**output_data)
                elif not isinstance(output_data, expected_schema):
                    result.add_error(f"Output does not match expected schema {expected_schema.__name__}")

            # Apply custom validation rules
            for rule_name, rule_func in self.custom_rules.items():
                try:
                    if not await rule_func(output_data):
                        result.add_warning(f"Output custom rule '{rule_name}' failed")
                except Exception as e:
                    result.add_warning(f"Output rule '{rule_name}' raised exception: {str(e)}")

            result.metadata["output_type"] = type(output_data).__name__

        except Exception as e:
            result.add_error(f"Output validation failed: {str(e)}")

        return result


class BackendValidator(BaseValidator):
    """Validates backend operations and data integrity."""

    async def validate_state(self, state: Dict[str, Any]) -> ValidationResult:
        """Validate backend state."""
        result = ValidationResult(
            is_valid=True,
            validation_type="backend_state"
        )

        try:
            # Check state serialization
            json.dumps(state, default=str)

            # Check for required state keys
            required_keys = self.custom_rules.get("required_keys", [])
            for key in required_keys:
                if key not in state:
                    result.add_error(f"Required state key missing: {key}")

            # Check state size
            state_size = len(json.dumps(state, default=str))
            if state_size > 10 * 1024 * 1024:  # 10MB limit
                result.add_warning(f"Large state size: {state_size / 1024 / 1024:.2f}MB")

            result.metadata["state_keys"] = list(state.keys())
            result.metadata["state_size"] = state_size

        except Exception as e:
            result.add_error(f"State validation failed: {str(e)}")

        return result


class AgentFactoryConfig(BaseModel):
    """Configuration for agent factory."""

    agent_name: str = Field(..., min_length=1, max_length=100)
    agent_type: str = Field(default="generic")
    system_prompt: str = Field(..., min_length=10)
    validation_level: ValidationLevel = Field(default=ValidationLevel.STRICT)
    enable_caching: bool = Field(default=True)
    enable_logging: bool = Field(default=True)
    max_retries: conint(ge=0, le=10) = Field(default=3)
    timeout_seconds: confloat(ge=1.0, le=3600.0) = Field(default=300.0)
    custom_validators: Dict[str, Any] = Field(default_factory=dict)
    dependencies_type: Optional[Type] = None

    class Config:
        arbitrary_types_allowed = True

    @field_validator('agent_name')
    @classmethod
    def validate_agent_name(cls, v: str) -> str:
        """Ensure agent name follows naming conventions."""
        if not v.replace('_', '').replace('-', '').isalnum():
            raise ValueError("Agent name must be alphanumeric with underscores/hyphens only")
        return v


class ValidatedAgent:
    """Wrapper for agents with validation capabilities."""

    def __init__(
        self,
        agent: Agent,
        config: AgentFactoryConfig,
        input_validator: InputValidator,
        output_validator: OutputValidator,
        backend_validator: BackendValidator
    ):
        self.agent = agent
        self.config = config
        self.input_validator = input_validator
        self.output_validator = output_validator
        self.backend_validator = backend_validator
        self.execution_history: List[Dict[str, Any]] = []
        self.validation_cache: Dict[str, ValidationResult] = {}

    async def run_with_validation(
        self,
        prompt: str,
        deps: Optional[Any] = None,
        input_schema: Optional[Type[BaseModel]] = None,
        output_schema: Optional[Type[BaseModel]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Execute agent with full validation pipeline."""
        execution_id = hashlib.md5(
            f"{self.config.agent_name}_{datetime.now().isoformat()}".encode()
        ).hexdigest()[:8]

        execution_record = {
            "id": execution_id,
            "agent": self.config.agent_name,
            "start_time": datetime.now().isoformat(),
            "validation_results": {}
        }

        try:
            # Input validation
            if self.config.validation_level != ValidationLevel.MINIMAL:
                input_validation = await self.input_validator.validate_input(
                    prompt,
                    schema=input_schema
                )
                execution_record["validation_results"]["input"] = input_validation.dict()

                if not input_validation.is_valid and self.config.validation_level == ValidationLevel.STRICT:
                    raise ValueError(f"Input validation failed: {input_validation.errors}")

            # Execute agent
            if self.config.enable_logging:
                logger.info(f"Executing agent: {self.config.agent_name}")

            if deps:
                result = await self.agent.run(prompt, deps=deps, **kwargs)
            else:
                result = await self.agent.run(prompt, **kwargs)

            # Output validation
            if self.config.validation_level != ValidationLevel.MINIMAL:
                output_data = getattr(result, 'data', result)
                output_validation = await self.output_validator.validate_output(
                    output_data,
                    expected_schema=output_schema
                )
                execution_record["validation_results"]["output"] = output_validation.dict()

                if not output_validation.is_valid and self.config.validation_level == ValidationLevel.STRICT:
                    raise ValueError(f"Output validation failed: {output_validation.errors}")

            execution_record["end_time"] = datetime.now().isoformat()
            execution_record["success"] = True
            execution_record["result"] = str(result)

        except Exception as e:
            execution_record["end_time"] = datetime.now().isoformat()
            execution_record["success"] = False
            execution_record["error"] = str(e)

            if self.config.enable_logging:
                logger.error(f"Agent execution failed: {self.config.agent_name} - {str(e)}")

            raise

        finally:
            self.execution_history.append(execution_record)

        return execution_record

    async def health_check(self) -> ValidationResult:
        """Perform health check on the agent."""
        result = ValidationResult(
            is_valid=True,
            validation_type="health_check"
        )

        # Check execution history
        if self.execution_history:
            total_executions = len(self.execution_history)
            failed_executions = sum(1 for e in self.execution_history if not e.get("success", False))

            result.metadata["total_executions"] = total_executions
            result.metadata["failed_executions"] = failed_executions
            result.metadata["success_rate"] = (total_executions - failed_executions) / total_executions

            if failed_executions > total_executions * 0.5:
                result.add_error("High failure rate detected")

        # Check configuration
        try:
            self.config.model_validate(self.config.model_dump())
            result.metadata["config_valid"] = True
        except Exception as e:
            result.add_error(f"Configuration invalid: {str(e)}")

        return result


class AgentFactory:
    """Factory for creating validated agents."""

    def __init__(self, default_validation_level: ValidationLevel = ValidationLevel.STRICT):
        self.default_validation_level = default_validation_level
        self._agent_registry: Dict[str, ValidatedAgent] = {}
        self._creation_count = 0

    def create_agent(
        self,
        config: AgentFactoryConfig,
        model_getter: Callable,
        custom_tools: Optional[List[Callable]] = None
    ) -> ValidatedAgent:
        """Create a new agent with validation capabilities."""
        # Create the Pydantic AI agent
        agent = Agent(
            model_getter(),
            deps_type=config.dependencies_type,
            system_prompt=config.system_prompt
        )

        # Register custom tools if provided
        if custom_tools:
            for tool in custom_tools:
                agent.tool(tool)

        # Create validators with custom rules if provided
        input_validator = InputValidator(
            validation_level=config.validation_level,
            custom_rules=config.custom_validators.get("input", {})
        )

        output_validator = OutputValidator(
            validation_level=config.validation_level,
            custom_rules=config.custom_validators.get("output", {})
        )

        backend_validator = BackendValidator(
            validation_level=config.validation_level,
            custom_rules=config.custom_validators.get("backend", {})
        )

        # Create validated agent
        validated_agent = ValidatedAgent(
            agent=agent,
            config=config,
            input_validator=input_validator,
            output_validator=output_validator,
            backend_validator=backend_validator
        )

        # Register agent
        self._agent_registry[config.agent_name] = validated_agent
        self._creation_count += 1

        if config.enable_logging:
            logger.info(f"Created agent: {config.agent_name} (type: {config.agent_type})")

        return validated_agent

    def get_agent(self, name: str) -> Optional[ValidatedAgent]:
        """Retrieve a registered agent by name."""
        return self._agent_registry.get(name)

    def list_agents(self) -> List[str]:
        """List all registered agent names."""
        return list(self._agent_registry.keys())

    async def validate_all_agents(self) -> Dict[str, ValidationResult]:
        """Validate all registered agents."""
        results = {}

        for name, agent in self._agent_registry.items():
            results[name] = await agent.health_check()

        return results

    def get_statistics(self) -> Dict[str, Any]:
        """Get factory statistics."""
        return {
            "agents_created": self._creation_count,
            "agents_registered": len(self._agent_registry),
            "agent_names": self.list_agents(),
            "validation_levels": {
                name: agent.config.validation_level.value
                for name, agent in self._agent_registry.items()
            },
            "execution_stats": {
                name: {
                    "total": len(agent.execution_history),
                    "successful": sum(1 for e in agent.execution_history if e.get("success", False))
                }
                for name, agent in self._agent_registry.items()
            }
        }


def create_agent_factory(
    default_config: Optional[AgentFactoryConfig] = None,
    validation_level: ValidationLevel = ValidationLevel.STRICT
) -> AgentFactory:
    """Create a new agent factory with optional default configuration."""
    factory = AgentFactory(default_validation_level=validation_level)

    if default_config:
        pass

    return factory


# --- Notesnook-specific factory creators ---

def create_typescript_agent_factory() -> AgentFactory:
    """Create a factory for TypeScript code analysis agents."""
    factory = AgentFactory(default_validation_level=ValidationLevel.STRICT)
    return factory


def create_eslint_agent_factory() -> AgentFactory:
    """Create a factory for ESLint AI agents."""
    factory = AgentFactory(default_validation_level=ValidationLevel.MODERATE)
    return factory


def create_build_resolver_factory() -> AgentFactory:
    """Create a factory for build resolver agents."""
    factory = AgentFactory(default_validation_level=ValidationLevel.STRICT)
    return factory
