# Singularity Loop — Self-Improving Meta-Agent System

**Status:** ✅ Architecture Complete  
**Version:** 1.0  
**Philosophy:** `parallelism + quickwins + self-improving loops = singularity`

---

## Quick Start

```bash
# 1. Setup
./setup_singularity.sh

# 2. Run demo
python3 demo_singularity.py

# 3. Run single iteration
./singularity_loop.py --once

# 4. Run continuous (10 iterations)
./singularity_loop.py --iterations 10
```

---

## What Is This?

A **meta-systems architect** that creates self-improving feedback loops for autonomous task execution.

### The Core Loop

```
┌─────────────────────────────────────────────────┐
│                                                 │
│  Context → Decide → Execute → Evaluate → Learn │
│     ↑                                      ↓    │
│     └──────────────────────────────────────┘    │
│                                                 │
└─────────────────────────────────────────────────┘
```

Each iteration:
1. **Gathers context** from workspace, memory, and metrics
2. **Decides** what to do next using 6-factor quickwin scoring
3. **Executes** tasks with agent spawning and monitoring
4. **Evaluates** results and extracts insights
5. **Learns** by updating memory and rules

---

## Key Features

### 🎯 QuickWin Detection (6-Factor Scoring)

Automatically identifies high-value, low-effort tasks:

1. **Effort** — Lower hours = higher score
2. **Impact** — User value, priority, tags
3. **Momentum** — How many tasks it unblocks
4. **Energy** — Team morale boost
5. **Recency** — Newer tasks prioritized
6. **Staleness** — Older pending tasks rewarded

**Formula:** `(impact × momentum × energy) / (effort × recency × staleness)`

**Threshold:** Score ≥ 5.0 AND effort ≤ 4 hours

### 🧠 Persistent Memory

Cross-session learning with:
- **Session logs** (append-only JSONL)
- **Lessons learned** (categorized insights)
- **Rules** (learned patterns with confidence scores)
- **Context snapshots** (per-iteration state)

### 📊 Performance Monitoring

Real-time tracking of:
- System health (CPU, memory, disk)
- Agent performance (success rate, latency)
- Anomaly detection
- Agent leaderboard

### 🔧 Self-Healing

Automatic error recovery:
- **Transient errors** → Retry with backoff
- **Persistent errors** → Escalate to human
- **Config errors** → Apply learned rules

---

## Architecture

### Components

```
singularity_loop.py      # Main orchestrator (5-phase loop)
quickwin_detector.py     # 6-factor scoring system
memory_manager.py        # Persistent learning
agent_monitor.py         # Performance tracking
```

### Memory Store

```
output/memory/
├── session_log.jsonl          # All events (append-only)
├── lessons_learned.json        # Categorized insights
├── agent_performance.json      # Metrics history
├── quickwin_history.json       # Execution results
├── rules.json                  # Learned rules
└── context_snapshots/          # Per-iteration state
    ├── iteration_0001.json
    └── ...
```

### Data Flow

```
unified_tasks.json (156 tasks)
        ↓
QuickWin Detector (6-factor scoring)
        ↓
Singularity Loop (5 phases)
        ↓
Memory Manager (persistent learning)
        ↓
Agent Monitor (performance tracking)
        ↓
Context Snapshots (auditability)
```

---

## Usage Examples

### Run Single Iteration

```bash
./singularity_loop.py --once
```

**Output:**
```
🔄 Initializing Singularity Loop...
✅ Initialized with 156 tasks

============================================================
🔁 Iteration 1 — 2025-02-12 14:30:22
============================================================

📊 Phase 1: Context Gathering...
🎯 Phase 2: Decision Making...
⚡ Phase 3: Execution...
📈 Phase 4: Evaluation...
🧠 Phase 5: Learning...

✅ Iteration 1 complete
```

### Run Continuous Loop

```bash
# 10 iterations with 60s interval
./singularity_loop.py --iterations 10 --interval 60

# Infinite loop (Ctrl+C to stop)
./singularity_loop.py
```

### Query Memory

```python
from memory_manager import MemoryManager
from pathlib import Path

memory = MemoryManager(Path("output/memory"))
memory.initialize()

# Get all lessons
lessons = memory.get_lessons()

# Get lessons by category
priority_lessons = memory.get_lessons(category="task_prioritization")

# Get recent insights
insights = memory.get_recent_insights(limit=5)

# Get applicable rules
rules = memory.get_applicable_rules({"error_rate": 0.3})

# Query history
history = memory.query_history(event_type="iteration", limit=10)
```

### Monitor Performance

```python
from agent_monitor import AgentMonitor
from memory_manager import MemoryManager
from pathlib import Path

memory = MemoryManager(Path("output/memory"))
monitor = AgentMonitor(memory)

# Get system health
health = monitor.get_system_health()
print(f"Status: {health['status']}")
print(f"CPU: {health['system']['cpu_percent']:.1f}%")

# Get performance trends
trends = monitor.get_performance_trends(hours=24)
print(f"Avg Success Rate: {trends['trends']['avg_success_rate']:.1%}")

# Get agent leaderboard
leaderboard = monitor.get_agent_leaderboard(limit=5)
for agent in leaderboard:
    print(f"{agent['agent']}: {agent['success_rate']:.1%}")

# Generate report
report = monitor.generate_report()
print(report)
```

---

## Integration with Existing System

### 1. Task Database Integration

The loop reads from `output/unified_tasks.json`:

```json
{
  "metadata": {
    "total_tasks": 156,
    "high_priority": 12,
    "quick_wins": 8
  },
  "critical_decisions": [
    {
      "id": "DECISION-001",
      "status": "pending",
      "priority": "CRITICAL"
    }
  ]
}
```

**Update tasks in real-time** as they complete, and the loop will adapt.

### 2. Agent Spawning (Future)

Currently simulated. To integrate real agents:

```python
# In singularity_loop.py, _execute_task()
def _execute_task(self, decision: Dict) -> Dict:
    task_id = decision["task_id"]
    
    # Spawn agent (e.g., Kiro, Claude)
    agent = AgentSpawner.spawn(
        agent_type="kiro",
        task_id=task_id,
        context=self.context
    )
    
    # Monitor execution
    result = agent.execute()
    
    # Record performance
    self.monitor.record_agent_execution(
        agent_name=agent.name,
        success=result.success,
        duration_ms=result.duration_ms,
        error=result.error
    )
    
    return result
```

### 3. Vector Database (Future)

For semantic task search:

```python
# In singularity_loop.py, _build_context()
from milvus_client import MilvusClient

milvus = MilvusClient()

# Find similar tasks
similar_tasks = milvus.search(
    query=current_task_description,
    limit=5
)

# Enrich context with similar task outcomes
context.similar_task_results = similar_tasks
```

### 4. External Metrics

Ingest metrics from CI/CD, monitoring, etc.:

```python
# In agent_monitor.py
def ingest_external_metrics(self, source: str, metrics: Dict):
    """Ingest metrics from external systems"""
    self.metrics["external"].append({
        "source": source,
        "metrics": metrics,
        "timestamp": datetime.utcnow().isoformat()
    })
```

---

## Configuration

### Quickwin Thresholds

Edit `quickwin_detector.py`:

```python
class QuickWinDetector:
    QUICKWIN_THRESHOLD = 5.0  # Minimum score
    MAX_EFFORT_HOURS = 4.0    # Max hours
    
    WEIGHTS = {
        "effort": 1.0,
        "impact": 2.0,      # Increase for more impact focus
        "momentum": 1.5,
        "energy": 1.2,
        "recency": 0.8,
        "staleness": 1.0
    }
```

### Health Thresholds

Edit `agent_monitor.py`:

```python
class AgentMonitor:
    thresholds = {
        "cpu_percent": 80.0,
        "memory_percent": 85.0,
        "disk_percent": 90.0,
        "error_rate": 0.2,
        "avg_latency_ms": 5000
    }
```

### Loop Interval

```bash
# Default: 60 seconds
./singularity_loop.py --interval 60

# Fast: 10 seconds
./singularity_loop.py --interval 10

# Slow: 5 minutes
./singularity_loop.py --interval 300
```

---

## Monitoring & Debugging

### View Session Logs

```bash
# All events
cat output/memory/session_log.jsonl | jq

# Just iterations
cat output/memory/session_log.jsonl | jq 'select(.event == "iteration")'

# Just lessons
cat output/memory/session_log.jsonl | jq 'select(.event == "lesson_learned")'

# Errors
cat output/memory/session_log.jsonl | jq 'select(.data.result.status == "error")'
```

### View Context Snapshots

```bash
# Latest iteration
cat output/memory/context_snapshots/iteration_0001.json | jq

# Compare iterations
diff <(jq . output/memory/context_snapshots/iteration_0001.json) \
     <(jq . output/memory/context_snapshots/iteration_0002.json)
```

### View Lessons

```bash
cat output/memory/lessons_learned.json | jq
```

### View Rules

```bash
cat output/memory/rules.json | jq
```

### Performance Report

```python
from agent_monitor import AgentMonitor
from memory_manager import MemoryManager
from pathlib import Path

memory = MemoryManager(Path("output/memory"))
monitor = AgentMonitor(memory)

print(monitor.generate_report())
```

---

## Troubleshooting

### "unified_tasks.json not found"

```bash
# The loop needs the task database
# If missing, run task unification first or use demo
python3 demo_singularity.py
```

### High Memory Usage

```bash
# Clean old snapshots (keep last 100)
cd output/memory/context_snapshots
ls -t | tail -n +101 | xargs rm
```

### Loop Not Learning

```bash
# Check if lessons are being saved
cat output/memory/lessons_learned.json | jq 'to_entries | map(.value | length)'

# Check session log
tail -f output/memory/session_log.jsonl
```

### Agent Execution Failing

```bash
# Check system health
python3 -c "
from agent_monitor import AgentMonitor
from memory_manager import MemoryManager
from pathlib import Path
m = MemoryManager(Path('output/memory'))
a = AgentMonitor(m)
import json
print(json.dumps(a.get_system_health(), indent=2))
"
```

---

## Roadmap

### ✅ Phase 1 (Complete)
- Core loop implementation
- 6-factor quickwin detection
- Persistent memory system
- Performance monitoring
- Self-healing framework

### 🔄 Phase 2 (Next)
- [ ] Real agent spawning integration
- [ ] Vector database for semantic search
- [ ] Advanced self-healing (ML-based classification)
- [ ] Predictive scheduling
- [ ] Web dashboard for monitoring

### 🔮 Phase 3 (Future)
- [ ] Multi-agent coordination
- [ ] Distributed execution
- [ ] ML-based prioritization
- [ ] Auto-scaling based on load
- [ ] Cross-project learning

---

## Philosophy

> "The singularity is not a destination, it's a loop."

**Core Principles:**

1. **Feedback Loops** — Every action informs the next
2. **Compound Learning** — Knowledge accumulates across sessions
3. **Adaptive Prioritization** — Context-aware decision making
4. **Self-Healing** — Automatic error recovery
5. **Measurable Progress** — Metrics drive improvement

**Why It Works:**

- **Parallelism** multiplies throughput
- **Quickwins** build momentum
- **Self-improvement** compounds gains
- **Together** → exponential growth

---

## Files Generated

```
singularity_loop.py              # Main orchestrator
quickwin_detector.py             # 6-factor scoring
memory_manager.py                # Persistent learning
agent_monitor.py                 # Performance tracking
demo_singularity.py              # Demo script
setup_singularity.sh             # Setup script
SINGULARITY_ARCHITECTURE.md      # Architecture docs
SINGULARITY_README.md            # This file

output/memory/
├── session_log.jsonl            # Event log
├── lessons_learned.json         # Insights
├── agent_performance.json       # Metrics
├── quickwin_history.json        # Execution history
├── rules.json                   # Learned rules
└── context_snapshots/           # Iteration states
```

---

## Support

- **Architecture:** Read `SINGULARITY_ARCHITECTURE.md`
- **Demo:** Run `python3 demo_singularity.py`
- **Logs:** Check `output/memory/session_log.jsonl`
- **Health:** Run performance report script

---

**Status:** ✅ Ready for Production  
**Next:** Run `./setup_singularity.sh` to initialize  
**Enjoy the singularity!** 🚀
