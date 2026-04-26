# Singularity Loop — Integration Guide

How to integrate the self-improving meta-agent system with your existing workflow.

---

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Existing System                          │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Task Unifier │  │ Kiro Agents  │  │ Milvus VectorDB│   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                  │                  │             │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
          ↓                  ↓                  ↓
┌─────────────────────────────────────────────────────────────┐
│              Singularity Loop (Meta-Agent)                  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Context Phase                                       │  │
│  │  • Load tasks from unified_tasks.json               │  │
│  │  • Query vector DB for similar tasks                │  │
│  │  • Load memory (lessons, rules, metrics)            │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Decide Phase                                        │  │
│  │  • Detect quickwins (6-factor scoring)              │  │
│  │  • Check for blockers                               │  │
│  │  • Apply learned rules                              │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Execute Phase                                       │  │
│  │  • Spawn Kiro agents for tasks                      │  │
│  │  • Monitor execution                                │  │
│  │  • Handle errors with self-healing                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Evaluate Phase                                      │  │
│  │  • Calculate success rate                           │  │
│  │  • Extract insights                                 │  │
│  │  • Detect anomalies                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Learn Phase                                         │  │
│  │  • Store lessons in memory                          │  │
│  │  • Update rules with confidence scores              │  │
│  │  • Save context snapshot                            │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│                    (Loop back to Context)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Integration

### Step 1: Task Database Integration

**Current State:**
- You have `output/unified_tasks.json` with 156 tasks
- Task unification is complete

**Integration:**

```python
# In singularity_loop.py, _build_context()

def _build_context(self) -> LoopContext:
    # Load tasks from unified database
    tasks_file = self.output_dir / "unified_tasks.json"
    with open(tasks_file) as f:
        self.tasks_data = json.load(f)
    
    # Extract task counts
    total_tasks = self.tasks_data["metadata"]["total_tasks"]
    completed = self.tasks_data["metadata"].get("completed", 0)
    
    # Detect blockers from critical decisions
    blockers = []
    for decision in self.tasks_data.get("critical_decisions", []):
        if decision["status"] == "pending":
            blockers.append(decision["id"])
    
    # ... rest of context building
```

**Action Required:**
- ✅ Already integrated (reads from unified_tasks.json)
- Update unified_tasks.json as tasks complete
- Add task completion webhook (optional)

### Step 2: Quickwin Detection Integration

**Current State:**
- 6-factor scoring implemented
- Needs actual task data

**Integration:**

```python
# Load track A and track B tasks
track_a_file = self.output_dir / "track_a_vanilla_js_tasks.json"
track_b_file = self.output_dir / "track_b_typescript_tasks.json"

all_tasks = []

if track_a_file.exists():
    with open(track_a_file) as f:
        track_a = json.load(f)
        all_tasks.extend(track_a.get("tasks", []))

if track_b_file.exists():
    with open(track_b_file) as f:
        track_b = json.load(f)
        all_tasks.extend(track_b.get("tasks", []))

# Detect quickwins
quickwin_candidates = self.quickwin.detect_quickwins({
    "tasks": all_tasks
})
```

**Action Required:**
- Create detailed task files with required fields:
  - `id`, `title`, `estimated_hours`, `priority`, `status`
  - `tags`, `unblocks`, `created_at`
- Or enhance unified_tasks.json with full task details

### Step 3: Agent Spawning Integration

**Current State:**
- Simulated execution (placeholder)

**Integration with Kiro:**

```python
# In singularity_loop.py, _execute_task()

def _execute_task(self, decision: Dict) -> Dict:
    task_id = decision["task_id"]
    task = self._get_task_by_id(task_id)
    
    # Spawn Kiro agent
    agent_result = self._spawn_kiro_agent(task)
    
    # Record performance
    self.monitor.record_agent_execution(
        agent_name="kiro",
        success=agent_result["success"],
        duration_ms=agent_result["duration_ms"],
        error=agent_result.get("error")
    )
    
    return agent_result

def _spawn_kiro_agent(self, task: Dict) -> Dict:
    """Spawn Kiro agent for task execution"""
    import subprocess
    import time
    
    start_time = time.time()
    
    try:
        # Call Kiro CLI or API
        result = subprocess.run(
            ["kiro", "execute", "--task", task["id"]],
            capture_output=True,
            text=True,
            timeout=task.get("estimated_hours", 1) * 3600
        )
        
        duration_ms = (time.time() - start_time) * 1000
        
        if result.returncode == 0:
            return {
                "status": "success",
                "task_id": task["id"],
                "success": True,
                "duration_ms": duration_ms,
                "output": result.stdout
            }
        else:
            return {
                "status": "error",
                "task_id": task["id"],
                "success": False,
                "duration_ms": duration_ms,
                "error": result.stderr
            }
    
    except subprocess.TimeoutExpired:
        return {
            "status": "timeout",
            "task_id": task["id"],
            "success": False,
            "duration_ms": (time.time() - start_time) * 1000,
            "error": "Task execution timeout"
        }
    except Exception as e:
        return {
            "status": "error",
            "task_id": task["id"],
            "success": False,
            "duration_ms": (time.time() - start_time) * 1000,
            "error": str(e)
        }
```

**Action Required:**
- Define Kiro agent execution interface
- Implement task → agent mapping
- Add timeout handling
- Implement result parsing

### Step 4: Vector Database Integration

**Current State:**
- Milvus client exists in `src/core/milvus-client.ts`

**Integration:**

```python
# In singularity_loop.py

from milvus_client import MilvusClient

class SingularityLoop:
    def __init__(self, workspace_root: Path = Path(".")):
        # ... existing init ...
        
        # Initialize Milvus
        self.milvus = MilvusClient(
            host="localhost",
            port=19530,
            collection_name="tasks"
        )
    
    def _build_context(self) -> LoopContext:
        # ... existing context building ...
        
        # Enrich with similar tasks
        if self.context.quickwin_candidates:
            for qw in self.context.quickwin_candidates:
                task = self._get_task_by_id(qw["task_id"])
                
                # Find similar tasks
                similar = self.milvus.search(
                    query=task["description"],
                    limit=3
                )
                
                # Add similar task outcomes to context
                qw["similar_tasks"] = similar
                qw["similar_success_rate"] = self._calculate_similar_success_rate(similar)
        
        return self.context
```

**Action Required:**
- Port Milvus client to Python or use REST API
- Embed task descriptions
- Store task outcomes in vector DB
- Query for similar tasks during context building

### Step 5: Memory System Integration

**Current State:**
- ✅ Fully implemented
- Persistent storage in `output/memory/`

**Integration:**

```python
# Already integrated, but can enhance with:

# 1. Import lessons from previous sessions
memory.import_knowledge_base(Path("output/memory/backup.json"))

# 2. Export for sharing across projects
memory.export_knowledge_base(Path("output/memory/export.json"))

# 3. Query lessons for specific contexts
lessons = memory.get_lessons(category="task_prioritization")
for lesson in lessons:
    print(f"Learned: {lesson['lesson']}")

# 4. Apply rules automatically
rules = memory.get_applicable_rules(context={
    "error_rate": 0.3,
    "cpu_percent": 85
})
for rule in rules:
    print(f"Applying rule: {rule['action']}")
```

**Action Required:**
- ✅ No action needed (already working)
- Optional: Add more lesson categories
- Optional: Enhance rule condition evaluation

### Step 6: Performance Monitoring Integration

**Current State:**
- ✅ System health monitoring implemented
- ✅ Agent performance tracking

**Integration with External Systems:**

```python
# In agent_monitor.py, add method:

def ingest_ci_metrics(self, build_id: str, metrics: Dict):
    """Ingest metrics from CI/CD pipeline"""
    self.metrics["ci_builds"].append({
        "build_id": build_id,
        "metrics": metrics,
        "timestamp": datetime.utcnow().isoformat()
    })

def ingest_deployment_metrics(self, deployment_id: str, metrics: Dict):
    """Ingest metrics from deployment"""
    self.metrics["deployments"].append({
        "deployment_id": deployment_id,
        "metrics": metrics,
        "timestamp": datetime.utcnow().isoformat()
    })

# Usage:
monitor.ingest_ci_metrics("build-123", {
    "duration_seconds": 120,
    "tests_passed": 45,
    "tests_failed": 2,
    "coverage_percent": 82.5
})
```

**Action Required:**
- Add webhooks from CI/CD to ingest metrics
- Add deployment monitoring
- Add custom metric ingestion

---

## Integration Checklist

### Phase 1: Basic Integration (Week 1)
- [x] Task database integration (unified_tasks.json)
- [x] Memory system setup
- [x] Performance monitoring
- [ ] Create detailed task files with all required fields
- [ ] Test quickwin detection with real tasks

### Phase 2: Agent Integration (Week 2)
- [ ] Define Kiro agent execution interface
- [ ] Implement task → agent spawning
- [ ] Add result parsing and error handling
- [ ] Test with 5 simple tasks
- [ ] Monitor agent performance

### Phase 3: Advanced Features (Week 3)
- [ ] Vector database integration
- [ ] Similar task search
- [ ] Predictive scheduling
- [ ] Advanced self-healing

### Phase 4: Production (Week 4)
- [ ] CI/CD integration
- [ ] Monitoring dashboard
- [ ] Alerting system
- [ ] Documentation
- [ ] Team training

---

## Configuration for Your Project

### 1. Adjust Quickwin Weights

Based on your project priorities:

```python
# In quickwin_detector.py

WEIGHTS = {
    "effort": 1.0,
    "impact": 3.0,      # Increase if user value is critical
    "momentum": 2.0,    # Increase if unblocking is important
    "energy": 1.0,      # Decrease if morale is less important
    "recency": 0.5,     # Decrease to prioritize newer tasks more
    "staleness": 1.5    # Increase to reward addressing old tasks
}
```

### 2. Set Health Thresholds

Based on your infrastructure:

```python
# In agent_monitor.py

thresholds = {
    "cpu_percent": 70.0,      # Lower for resource-constrained systems
    "memory_percent": 80.0,
    "disk_percent": 85.0,
    "error_rate": 0.15,       # Lower for critical systems
    "avg_latency_ms": 3000    # Lower for real-time systems
}
```

### 3. Configure Loop Interval

Based on your workflow:

```bash
# Fast iteration (development)
./singularity_loop.py --interval 30

# Normal (production)
./singularity_loop.py --interval 60

# Slow (resource-constrained)
./singularity_loop.py --interval 300
```

---

## Testing Integration

### Test 1: Quickwin Detection

```bash
python3 demo_singularity.py
```

Expected output:
- List of quickwin candidates
- Scores and breakdowns
- Reasons for selection

### Test 2: Memory System

```python
from memory_manager import MemoryManager
from pathlib import Path

memory = MemoryManager(Path("output/memory"))
memory.initialize()

# Add test lesson
memory.add_lesson(
    category="test",
    lesson="This is a test lesson",
    context={"test": True}
)

# Verify
lessons = memory.get_lessons(category="test")
assert len(lessons) == 1
print("✅ Memory system working")
```

### Test 3: Agent Monitor

```python
from agent_monitor import AgentMonitor
from memory_manager import MemoryManager
from pathlib import Path

memory = MemoryManager(Path("output/memory"))
monitor = AgentMonitor(memory)

# Record test execution
monitor.record_agent_execution(
    agent_name="test_agent",
    success=True,
    duration_ms=1000.0
)

# Verify
health = monitor.get_system_health()
assert health["agents"]["total_executions"] > 0
print("✅ Agent monitor working")
```

### Test 4: Full Loop

```bash
./singularity_loop.py --once
```

Expected output:
- Context gathered
- Decisions made
- Execution results
- Evaluation complete
- Learning saved

---

## Troubleshooting Integration

### Issue: Tasks not detected

**Cause:** Task file format mismatch

**Solution:**
```python
# Ensure tasks have required fields
required_fields = [
    "id", "title", "estimated_hours", "priority",
    "status", "tags", "unblocks", "created_at"
]

for task in tasks:
    for field in required_fields:
        assert field in task, f"Missing field: {field}"
```

### Issue: Agents not spawning

**Cause:** Agent interface not implemented

**Solution:**
- Implement `_spawn_kiro_agent()` method
- Test with simple task first
- Add logging for debugging

### Issue: Memory not persisting

**Cause:** Directory permissions or path issues

**Solution:**
```bash
# Check directory exists
ls -la output/memory/

# Check permissions
chmod -R u+w output/memory/

# Check disk space
df -h
```

### Issue: High resource usage

**Cause:** Too many parallel executions

**Solution:**
```python
# In singularity_loop.py, add concurrency limit

MAX_PARALLEL_TASKS = 3

def _execute_decisions(self, decisions: List[Dict]) -> List[Dict]:
    # Limit parallel execution
    decisions = decisions[:MAX_PARALLEL_TASKS]
    # ... rest of execution
```

---

## Next Steps

1. **Run Setup:**
   ```bash
   ./setup_singularity.sh
   ```

2. **Run Demo:**
   ```bash
   python3 demo_singularity.py
   ```

3. **Test Integration:**
   - Create detailed task files
   - Test quickwin detection
   - Test agent spawning

4. **Deploy:**
   - Run continuous loop
   - Monitor performance
   - Review lessons learned

5. **Iterate:**
   - Adjust weights based on results
   - Add custom rules
   - Enhance self-healing

---

**Integration Status:** 🟡 Partial (Core ready, agent spawning pending)  
**Next:** Implement agent spawning interface  
**Support:** Review session logs in `output/memory/`
