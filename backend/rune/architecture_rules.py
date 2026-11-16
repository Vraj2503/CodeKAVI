from dataclasses import dataclass, field

from .architecture_models import ArchitectureTechnology


@dataclass
class TechRule:
    vendor: str
    product: str
    kind: str
    purpose: str | None = None
    model_name: str | None = None
    # triggers can be package names, internal module names, or substrings in requirements
    triggers: list[str] = field(default_factory=list)


TECHNOLOGY_CATALOG: list[TechRule] = [
    # Databases & BaaS
    TechRule(
        "Supabase",
        "Auth, Postgres & Storage",
        "external",
        purpose="Backend as a Service",
        triggers=["@supabase/supabase-js", "supabase"],
    ),
    TechRule(
        "PostgreSQL",
        "Database",
        "datastore",
        purpose="Relational database",
        triggers=["pg", "pg-promise", "asyncpg", "psycopg2", "psycopg"],
    ),
    TechRule(
        "Redis",
        "Cache & Rate Limits",
        "cache",
        purpose="In-memory cache",
        triggers=["redis", "ioredis", "aioredis", "redis-py"],
    ),
    TechRule(
        "MongoDB",
        "Database",
        "datastore",
        purpose="NoSQL document store",
        triggers=["mongodb", "mongoose", "pymongo", "motor"],
    ),
    TechRule(
        "MySQL",
        "Database",
        "datastore",
        purpose="Relational database",
        triggers=["mysql", "mysql2", "pymysql", "mysqlclient"],
    ),
    # Vector Stores
    TechRule(
        "Zilliz Cloud",
        "Milvus",
        "external",
        purpose="Vector database",
        triggers=["@zilliz/milvus2-sdk-node", "pymilvus"],
    ),
    TechRule(
        "Pinecone",
        "Vector Database",
        "external",
        purpose="Vector search",
        triggers=["@pinecone-database/pinecone", "pinecone-client", "pinecone-plugin"],
    ),
    TechRule(
        "Qdrant",
        "Vector Database",
        "external",
        purpose="Vector search",
        triggers=["@qdrant/js-client-rest", "qdrant-client"],
    ),
    TechRule("Chroma", "Vector Database", "datastore", purpose="Vector search", triggers=["chromadb"]),
    # AI & ML Providers
    TechRule(
        "Cloudflare", "Workers AI", "external", purpose="Edge inference", triggers=["@cloudflare/ai", "cloudflare"]
    ),
    TechRule("OpenAI", "Models", "external", purpose="Large language models", triggers=["openai", "openai-node"]),
    TechRule(
        "Anthropic",
        "Claude",
        "external",
        purpose="Language & reasoning models",
        triggers=["@anthropic-ai/sdk", "anthropic"],
    ),
    TechRule(
        "Google",
        "Gemini",
        "external",
        purpose="Multimodal foundation models",
        # Python imports name the module, never the pip package.
        triggers=["@google/genai", "google-generativeai", "google.genai", "google.generativeai"],
    ),
    # Not "Llama": Groq serves several model families (CodeKAVI runs gpt-oss-120b on it).
    TechRule("Groq", "Inference API", "external", purpose="Low-latency LPU inference", triggers=["groq-sdk", "groq"]),
    TechRule("Ollama", "Local LLM", "external", purpose="Self-hosted local models", triggers=["ollama"]),
    # Message Queues & Async
    TechRule(
        "Apache Kafka",
        "Kafka",
        "queue",
        purpose="Distributed event streaming",
        triggers=["kafkajs", "confluent-kafka", "kafka-python"],
    ),
    TechRule("RabbitMQ", "RabbitMQ", "queue", purpose="Message broker", triggers=["amqplib", "pika", "aio_pika"]),
    # AWS Services (Generic sweeps)
    TechRule("AWS", "S3", "external", purpose="Object Storage", triggers=["@aws-sdk/client-s3", "boto3-s3"]),
    TechRule("AWS", "SQS", "external", purpose="Message Queue", triggers=["@aws-sdk/client-sqs", "boto3-sqs"]),
    TechRule(
        "AWS", "Lambda", "external", purpose="Serverless Compute", triggers=["@aws-sdk/client-lambda", "boto3-lambda"]
    ),
    TechRule("AWS", "EventBridge", "external", purpose="Event Bus", triggers=["@aws-sdk/client-eventbridge"]),
    # Git Hosts
    TechRule("GitHub", "API", "external", purpose="Source control", triggers=["@octokit/rest", "PyGithub", "github"]),
    TechRule("GitLab", "API", "external", purpose="Source control", triggers=["python-gitlab", "@gitbeaker/node"]),
    TechRule("Bitbucket", "API", "external", purpose="Source control", triggers=["bitbucket-python", "bitbucket"]),
]


def _names_package(names: set[str], trigger: str) -> bool:
    """Whether an import is the trigger package or one of its submodules (T39).

    Whole names only: substring matching made `pg` fire on `upgrade` and `jpg`,
    and `github` on any path that mentioned it.
    """
    return any(name == trigger or name.startswith((trigger + ".", trigger + "/")) for name in names)


def match_technologies(hints: set[str]) -> list[ArchitectureTechnology]:
    """
    Given a set of strings (e.g. package names, explicit imports, config keywords),
    return matched ArchitectureTechnology instances.
    """
    matched: dict[str, ArchitectureTechnology] = {}
    names = {h.strip().lower() for h in hints if h and h.strip()}

    for rule in TECHNOLOGY_CATALOG:
        # Prevent duplicate vendors if we already matched a broader rule
        key = f"{rule.vendor}:{rule.product}"
        if key in matched:
            continue

        for trigger in rule.triggers:
            if _names_package(names, trigger.lower()):
                matched[key] = ArchitectureTechnology(
                    vendor=rule.vendor,
                    product=rule.product,
                    model=rule.model_name,
                    purpose=rule.purpose,
                    confidence=0.9,
                )
                break

    return list(matched.values())


def determine_node_role(file_role: str, path: str) -> str:
    """
    Map file-level classifier roles to broad architectural responsibility clusters.
    """
    role_map = {
        "entry_point": "API & Request Entry",
        "router": "API & Request Entry",
        "orchestrator": "Application Orchestration",
        "core_module": "Application Orchestration",
        "ml_pipeline": "Processing Pipeline",
        "ml_training": "Processing Pipeline",
        "data": "Data Access",
        "shared_utility": "Shared Application Services",
        "internal_helper": "Shared Application Services",
        "api_route": "API Route Handler",
        "api_controller": "API & Access Control",
        "service": "Application Service",
        "repository": "Data Access",
        "model": "Domain Models",
        "ui_component": "Client Interface",
        "page": "Client Page",
        "worker": "Background Worker",
        "job": "Background Job",
        "middleware": "Middleware & Auth",
        "config": "Configuration",
    }

    label = role_map.get(file_role)
    if label:
        return label

    path_lower = path.lower()
    if "auth" in path_lower:
        return "Authentication & Session"
    if "pipeline" in path_lower:
        return "Processing Pipeline"
    if "notification" in path_lower:
        return "Messaging / Notifications"

    return "Application Component"


def determine_node_kind(file_role: str) -> str:
    """
    Map to an architecture.v2 kind (client, gateway, service, worker, datastore, etc.)
    """
    role_to_kind = {
        "entry_point": "gateway",
        "router": "gateway",
        "orchestrator": "service",
        "core_module": "service",
        "ml_pipeline": "service",
        "ml_training": "service",
        "data": "datastore",
        "api_route": "gateway",
        "api_controller": "gateway",
        "middleware": "gateway",
        "service": "service",
        "worker": "worker",
        "job": "worker",
        "repository": "datastore",
        "ui_component": "client",
        "page": "client",
    }
    return role_to_kind.get(file_role, "service")


def format_evidence_sentence(evidence_paths: list[str]) -> str:
    """The files a component rests on, as the closing line of its AI description; "" with none.

    Facts only. It used to end in a clause about architecture ("establishing a cohesive
    architectural boundary"), and with no files it said that and nothing else.
    """
    clean_paths = [p for p in evidence_paths if p and not p.startswith("<")]
    if not clean_paths:
        return ""
    names = " and ".join(f"`{p.split('/')[-1]}`" for p in clean_paths[:2])
    if len(clean_paths) <= 2:
        return f"Implemented in {names}."
    return f"Implemented in {len(clean_paths)} source files, including {names}."
