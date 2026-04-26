# Singularity Loop Architecture

**Meta-systems architect for self-improving automation**

Philosophy: `parallelism + quickwins + self-improving loops = singularity`

---

## The Loop

```
Context (vectordb + memory) 
    ↓
Decide (quickwin detect) 
    ↓
Execute (agents + tools) 
    ↓
Evaluate (metrics + learn) 
    ↓
Context (feedback loop)
```

---

## Architecture Overview

### Core Components

1. **Singularity Loop** (`singularity_loop.py`)
   - Main orchestrator
   - Runs 5-phase iterations
   - Manages agent lifecycle
   - Handles self-healing

2. **QuickWin Detector** (`quickwin_detector.py`)
   - 6-factor scoring system
   - Deterministic prioritization
   - History tracking

3. **Memory Manager** (`memory_manager.py`)
   - Persistent cross-session learning
   - Append-only session logs
   - Categorized lessons
   - Rule learning system

4. **Agent Monitor** (`agent_monitor.py`)
   - Performance tracking
   - System health monitoring
   - Anomaly detection
   - Agent leaderboard

---

## The 5 Phases

### Phase 1: Context Gathering
**Input:** Workspace state, memory, metrics  
**Output:** LoopContext object

- Load task database
- Check for blockers
- Detect quickwin candidates
- Assess system health
- Retrieve recent insights

### Phase 2: Decision Making
**Input:** LoopContext  
**Output:** List of decisions

- Prioritize blockers (escalate to human)
- Select top 3 quickwins
- Schedule maintenance if needed
- Apply learned rules

### Phase 3: Execution
**Input:** Decisions  
**Output:** Execution results

- Spawn agents for tasks
- Monitor execution
- Handle errors with self-healing
- Track performance metrics

### Phase 4: Evaluation
**Input:** Execution results  
**Output:** Evaluation report

- Calculate success rate
- Extract insights
- Detect patterns
- Identify improvements

### Phase 5: Learning
**Input:** Evaluation  
**Output:** Updated memory

- Store lessons learned
- Update agent performance
- Create/update rules
- Save context snapshot

---

## QuickWin Scoring (6 Factors)

### 1. Effort (hours)
- **Lower is better**
- Max 4 hours for quickwin
- Inverse scoring: `1 / effort`

### 2. Impact (user value)
- **Higher is better**
- Scale: 0-10
- Boosted by: priority, user-facing, blocker tags

### 3. Momentum (unblocks tasks)
- **Higher is better**
- Scale: 0-10
- Based on dependency count

### 4. Energy (team morale)
- **Higher is better**
- Scale: 0-10
- Boosted by: polish, cleanup, user-facing

### 5. Recency (how new)
- **Newer is better**
- Penalty factor: 0.5-1.5
- Recent tasks prioritized

### 6. Staleness (how old)
- **Older is better**
- Bonus factor: 1.0-2.0
- Rewards addressing old tasks

### Formula

```python
score = (impact * momentum * energy) / (effort * recency * staleness)
```

**Threshold:** score ≥ 5.0 AND effort ≤ 4h

---

## Memory Store Structure

```
output/memory/
├── session_log.jsonl          # Append-only event log
├── lessons_learned.json        # Categorized insights
├── agent_performance.json      # Metrics tracking
├── quickwin_history.json       # Quickwin execution history
├── rules.json                  # Learned rules
└── context_snapshots/          # Per-iteration state
    ├── iteration_0001.json
    ├── iteration_0002.json
    └── ...
```

### Session Log Format

```jsonl
{"event": "session_start", "session_id": "20250212_143022", "timestamp": "..."}
{"event": "iteration", "data": {...}, "timestamp": "..."}
{"event": "lesson_learned", "category": "...", "lesson": "...", "timestamp": "..."}
{"event": "rule_created", "rule": {...}, "timestamp": "..."}
{"event": "session_end", "summary": {...}, "timestamp": "..."}
```

### Lessons Format

```json
{
  "task_prioritization": [
    {
      "lesson": "Blockers must be resolved before other work",
      "learned_at": "2025-02-12T14:30:00Z",
      "session_id": "20250212_143022",
      "context": {"iteration": 1}
    }
  ],
  "error_handling": [...],
  "performance_optimization": [...],
  "architectural_decisions": [...]
}
```

### Rules Format

```json
[
  {
    "id": "RULE-001",
    "rule": "If error_rate > 0.2, reduce parallelism",
    "condition": "error_rate > 0.2",
    "action": "reduce_parallelism",
    "confidence": 0.85,
    "created_at": "2025-02-12T14:30:00Z",
    "applied_count": 12,
    "success_count": 10
  }
]
```

---

## Self-Healing System

### Error Classification

1. **Transient** (network, timeout)
   - Auto-retry with exponential backoff
   - Max 3 retries
   - Log pattern for learning

2. **Persistent** (bug, missing dependency)
   - Escalate to human review
   - Create task for fix
   - Log for pattern detection

3. **Configuration** (wrong settings)
   - Auto-fix if rule exists
   - Otherwise escalate
   - Learn rule for future

### Healing Flow

```
Error Detected
    ↓
Classify Error Type
    ↓
Transient? → Retry with backoff
    ↓
Persistent? → Escalate to human
    ↓
Config? → Apply rule or escalate
    ↓
Log for Learning
```

---

## Usage

### Single Iteration

```bash
./singularity_loop.py --once
```

### Continuous Loop

```bash
# Run 10 iterations
./singularity_loop.py --iterations 10

# Run indefinitely (60s interval)
./singularity_loop.py

# Custom interval
./singularity_loop.py --interval 120
```

### Monitor Performance

```python
from agent_monitor import AgentMonitor
from memory_manager import MemoryManager

memory = MemoryManager(Path("output/memory"))
monitor = AgentMonitor(memory)

# Get health
health = monitor.get_system_health()
print(health)

# Get report
report = monitor.generate_report()
print(report)
```

### Query Memory

```python
from memory_manager import MemoryManager

memory = MemoryManager(Path("output/memory"))
memory.initialize()

# Get lessons
lessons = memory.get_lessons(category="task_prioritization")

# Get applicable rules
rules = memory.get_applicable_rules({"error_rate": 0.3})

# Query history
history = memory.query_history(event_type="iteration", limit=10)
```

---

## Integration Points

### 1. Task Database
- **Input:** `output/unified_tasks.json`
- **Format:** See task unification schema
- **Updates:** Real-time as tasks complete

### 2. Vector Database (Future)
- **Purpose:** Semantic task search
- **Integration:** Milvus client
- **Use case:** Find similar tasks, context enrichment

### 3. Agent Spawning (Future)
- **Current:** Simulated execution
- **Future:** Spawn actual agents (Kiro, Claude, etc.)
- **Protocol:** Message passing, result collection

### 4. External Tools
- **Git:** Commit tracking, branch management
- **CI/CD:** Test results, deployment status
- **Monitoring:** External metrics ingestion

---

## Metrics & KPIs

### Loop Performance
- Iterations per hour
- Decisions per iteration
- Success rate
- Average iteration time

### Task Execution
- Tasks completed per day
- Quickwin success rate
- Blocker resolution time
- Parallel execution efficiency

### Learning
- Lessons learned per session
- Rules created per week
- Rule confidence trends
- Knowledge base growth

### System Health
- CPU/Memory/Disk usage
- Error rate
- Agent performance
- Anomaly frequency

---

## Constraints & Guarantees

### Constraints

1. **Memory Store**
   - Session logs are append-only
   - No deletion of historical data
   - Snapshots immutable after creation

2. **Quickwin Scoring**
   - Must be deterministic
   - Same inputs → same score
   - No randomness in prioritization

3. **State Persistence**
   - Always save state before exit
   - Graceful shutdown required
   - No data loss on interrupt

### Guarantees

1. **Idempotency**
   - Re-running same iteration produces same decisions
   - Context snapshots enable replay

2. **Auditability**
   - Every decision logged
   - Full trace from context → decision → result

3. **Recoverability**
   - Can resume from any iteration
   - State fully reconstructible from logs

---

## Future Enhancements

### Phase 1 (Current)
- ✅ Core loop implementation
- ✅ QuickWin detection
- ✅ Memory management
- ✅ Performance monitoring

### Phase 2 (Next)
- [ ] Vector database integration
- [ ] Real agent spawning
- [ ] Advanced self-healing
- [ ] Predictive scheduling

### Phase 3 (Future)
- [ ] Multi-agent coordination
- [ ] Distributed execution
- [ ] ML-based prioritization
- [ ] Auto-scaling

---

## Troubleshooting

### Loop Not Starting
```bash
# Check dependencies
pip3 install psutil

# Verify task database exists
ls -la output/unified_tasks.json

# Check memory directory
ls -la output/memory/
```

### High Error Rate
```bash
# Check system health
python3 -c "from agent_monitor import AgentMonitor; from memory_manager import MemoryManager; from pathlib import Path; m = MemoryManager(Path('output/memory')); a = AgentMonitor(m); print(a.get_system_health())"

# Review error logs
tail -f output/memory/session_log.jsonl | grep error
```

### Memory Issues
```bash
# Check memory usage
du -sh output/memory/

# Clean old snapshots (keep last 100)
cd output/memory/context_snapshots
ls -t | tail -n +101 | xargs rm
```

---

## Philosophy

> "The singularity is not a destination, it's a loop. Each iteration makes the next one smarter, faster, better. Parallelism multiplies throughput. Quickwins build momentum. Self-improvement compounds gains. Together, they create exponential growth."

**Key Principles:**

1. **Feedback Loops** — Every action informs the next
2. **Compound Learning** — Knowledge accumulates across sessions
3. **Adaptive Prioritization** — Context-aware decision making
4. **Self-Healing** — Automatic error recovery
5. **Measurable Progress** — Metrics drive improvement

---

**Status:** ✅ Architecture Complete  
**Next:** Run `./setup_singularity.sh` to initialize  
**Docs:** This file  
**Support:** Review session logs in `output/memory/`
