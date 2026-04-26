#!/usr/bin/env python3
"""
Singularity Loop Orchestrator — Meta-Agent for Self-Improving Automation

Philosophy: parallelism + quickwins + self-improving loops = singularity

The Loop:
Context (vectordb + memory) → Decide (quickwin detect) → Execute (agents + tools) → Evaluate (metrics + learn) → Context
"""

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict

from quickwin_detector import QuickWinDetector
from memory_manager import MemoryManager
from agent_monitor import AgentMonitor


@dataclass
class LoopContext:
    """Current state of the singularity loop"""
    iteration: int
    timestamp: str
    tasks_available: int
    tasks_completed: int
    blockers: List[str]
    active_agents: List[str]
    quickwin_candidates: List[Dict]
    system_health: Dict[str, Any]
    learning_insights: List[str]


class SingularityLoop:
    """Main orchestrator for self-improving task automation"""
    
    def __init__(self, workspace_root: Path = Path(".")):
        self.workspace = workspace_root
        self.output_dir = workspace_root / "output"
        self.memory_dir = self.output_dir / "memory"
        
        # Initialize subsystems
        self.memory = MemoryManager(self.memory_dir)
        self.quickwin = QuickWinDetector(self.memory)
        self.monitor = AgentMonitor(self.memory)
        
        # Loop state
        self.iteration = 0
        self.running = False
        self.context: Optional[LoopContext] = None
        
        # Ensure directories exist
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        
    def initialize(self):
        """Initialize the loop with current workspace state"""
        print("🔄 Initializing Singularity Loop...")
        
        # Load existing tasks
        tasks_file = self.output_dir / "unified_tasks.json"
        if tasks_file.exists():
            with open(tasks_file) as f:
                self.tasks_data = json.load(f)
        else:
            raise FileNotFoundError("unified_tasks.json not found. Run task unification first.")
        
        # Initialize memory systems
        self.memory.initialize()
        
        # Load or create initial context
        self.context = self._build_context()
        
        print(f"✅ Initialized with {self.context.tasks_available} tasks")
        
    def _build_context(self) -> LoopContext:
        """Build current loop context from workspace state"""
        # Count tasks
        total_tasks = self.tasks_data.get("metadata", {}).get("total_tasks", 0)
        
        # Detect blockers
        blockers = []
        if self.tasks_data.get("critical_decisions"):
            for decision in self.tasks_data["critical_decisions"]:
                if decision["status"] == "pending":
                    blockers.append(decision["id"])
        
        # Get quickwin candidates
        quickwin_candidates = self.quickwin.detect_quickwins(self.tasks_data)
        
        # Get system health
        system_health = self.monitor.get_system_health()
        
        # Get recent learning insights
        learning_insights = self.memory.get_recent_insights(limit=5)
        
        return LoopContext(
            iteration=self.iteration,
            timestamp=datetime.utcnow().isoformat(),
            tasks_available=total_tasks,
            tasks_completed=self.tasks_data.get("metadata", {}).get("completed", 0),
            blockers=blockers,
            active_agents=[],
            quickwin_candidates=quickwin_candidates,
            system_health=system_health,
            learning_insights=learning_insights
        )
    
    def run_iteration(self) -> Dict[str, Any]:
        """Execute one iteration of the singularity loop"""
        self.iteration += 1
        print(f"\n{'='*60}")
        print(f"🔁 Iteration {self.iteration} — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*60}\n")
        
        # Phase 1: Context — Gather current state
        print("📊 Phase 1: Context Gathering...")
        self.context = self._build_context()
        self._save_context_snapshot()
        
        # Phase 2: Decide — Select next actions
        print("🎯 Phase 2: Decision Making...")
        decisions = self._make_decisions()
        
        # Phase 3: Execute — Run agents/tools
        print("⚡ Phase 3: Execution...")
        execution_results = self._execute_decisions(decisions)
        
        # Phase 4: Evaluate — Measure outcomes
        print("📈 Phase 4: Evaluation...")
        evaluation = self._evaluate_results(execution_results)
        
        # Phase 5: Learn — Update memory
        print("🧠 Phase 5: Learning...")
        self._learn_from_iteration(evaluation)
        
        # Log iteration
        self.memory.log_iteration({
            "iteration": self.iteration,
            "context": asdict(self.context),
            "decisions": decisions,
            "results": execution_results,
            "evaluation": evaluation
        })
        
        print(f"\n✅ Iteration {self.iteration} complete\n")
        
        return {
            "iteration": self.iteration,
            "success": True,
            "decisions_made": len(decisions),
            "tasks_executed": len(execution_results),
            "insights_learned": len(evaluation.get("insights", []))
        }
    
    def _make_decisions(self) -> List[Dict[str, Any]]:
        """Decide what to do next based on context"""
        decisions = []
        
        # Check for blockers first
        if self.context.blockers:
            decisions.append({
                "type": "escalate_blocker",
                "priority": "CRITICAL",
                "blocker_ids": self.context.blockers,
                "reason": "Critical decisions pending"
            })
            return decisions  # Don't proceed until blockers resolved
        
        # Select quickwins
        if self.context.quickwin_candidates:
            top_quickwins = self.context.quickwin_candidates[:3]
            for qw in top_quickwins:
                decisions.append({
                    "type": "execute_task",
                    "priority": "HIGH",
                    "task_id": qw["task_id"],
                    "reason": f"Quickwin: {qw['reason']}",
                    "estimated_hours": qw["estimated_hours"]
                })
        
        # Check system health
        if self.context.system_health.get("needs_maintenance"):
            decisions.append({
                "type": "system_maintenance",
                "priority": "MEDIUM",
                "actions": self.context.system_health["maintenance_actions"]
            })
        
        return decisions
    
    def _execute_decisions(self, decisions: List[Dict]) -> List[Dict]:
        """Execute decided actions"""
        results = []
        
        for decision in decisions:
            print(f"  → Executing: {decision['type']} (Priority: {decision['priority']})")
            
            if decision["type"] == "escalate_blocker":
                result = self._escalate_to_human(decision)
            elif decision["type"] == "execute_task":
                result = self._execute_task(decision)
            elif decision["type"] == "system_maintenance":
                result = self._run_maintenance(decision)
            else:
                result = {"status": "unknown_decision_type"}
            
            results.append({
                "decision": decision,
                "result": result,
                "timestamp": datetime.utcnow().isoformat()
            })
        
        return results
    
    def _evaluate_results(self, results: List[Dict]) -> Dict[str, Any]:
        """Evaluate execution results and extract insights"""
        evaluation = {
            "total_actions": len(results),
            "successful": 0,
            "failed": 0,
            "insights": [],
            "metrics": {}
        }
        
        for result in results:
            if result["result"].get("status") == "success":
                evaluation["successful"] += 1
            else:
                evaluation["failed"] += 1
        
        # Extract insights
        if evaluation["failed"] > 0:
            evaluation["insights"].append({
                "type": "failure_pattern",
                "message": f"{evaluation['failed']} actions failed this iteration",
                "recommendation": "Review error logs and adjust strategy"
            })
        
        # Calculate metrics
        evaluation["metrics"] = {
            "success_rate": evaluation["successful"] / len(results) if results else 0,
            "iteration": self.iteration,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        return evaluation
    
    def _learn_from_iteration(self, evaluation: Dict):
        """Update memory with learnings from this iteration"""
        # Store insights
        for insight in evaluation.get("insights", []):
            self.memory.add_lesson(
                category=insight["type"],
                lesson=insight["message"],
                context={"iteration": self.iteration}
            )
        
        # Update agent performance
        self.monitor.record_iteration_metrics(evaluation["metrics"])
        
        # Update quickwin history
        self.quickwin.update_history(evaluation)
    
    def _save_context_snapshot(self):
        """Save current context for debugging/analysis"""
        snapshot_dir = self.memory_dir / "context_snapshots"
        snapshot_dir.mkdir(exist_ok=True)
        
        snapshot_file = snapshot_dir / f"iteration_{self.iteration:04d}.json"
        with open(snapshot_file, "w") as f:
            json.dump(asdict(self.context), f, indent=2)
    
    def _escalate_to_human(self, decision: Dict) -> Dict:
        """Create human review task for blockers"""
        print(f"    ⚠️  Escalating blockers to human: {decision['blocker_ids']}")
        
        # Create escalation file
        escalation_file = self.output_dir / "HUMAN_REVIEW_REQUIRED.md"
        with open(escalation_file, "w") as f:
            f.write(f"# 🚨 Human Review Required\n\n")
            f.write(f"**Generated:** {datetime.now().isoformat()}\n")
            f.write(f"**Iteration:** {self.iteration}\n\n")
            f.write(f"## Blockers\n\n")
            for blocker_id in decision["blocker_ids"]:
                f.write(f"- {blocker_id}\n")
            f.write(f"\n## Action Required\n\n")
            f.write(f"Review `output/EXECUTIVE_SUMMARY.md` and make architectural decision.\n")
        
        return {
            "status": "escalated",
            "file": str(escalation_file)
        }
    
    def _execute_task(self, decision: Dict) -> Dict:
        """Execute a task (placeholder for agent integration)"""
        print(f"    🔧 Task: {decision['task_id']} ({decision['estimated_hours']}h)")
        
        # In real implementation, this would:
        # 1. Spawn appropriate agent
        # 2. Monitor execution
        # 3. Handle errors with self-healing
        # 4. Return results
        
        return {
            "status": "simulated",
            "task_id": decision["task_id"],
            "message": "Task execution requires agent integration"
        }
    
    def _run_maintenance(self, decision: Dict) -> Dict:
        """Run system maintenance tasks"""
        print(f"    🔧 Maintenance: {len(decision['actions'])} actions")
        
        return {
            "status": "completed",
            "actions_completed": decision["actions"]
        }
    
    def run_continuous(self, max_iterations: Optional[int] = None, interval_seconds: int = 60):
        """Run the loop continuously"""
        self.running = True
        iterations_run = 0
        
        print(f"🚀 Starting continuous loop (max_iterations={max_iterations}, interval={interval_seconds}s)")
        
        try:
            while self.running:
                self.run_iteration()
                iterations_run += 1
                
                if max_iterations and iterations_run >= max_iterations:
                    print(f"✅ Reached max iterations ({max_iterations})")
                    break
                
                if self.running:
                    print(f"⏸️  Sleeping {interval_seconds}s until next iteration...")
                    time.sleep(interval_seconds)
        
        except KeyboardInterrupt:
            print("\n⚠️  Interrupted by user")
        finally:
            self.stop()
    
    def stop(self):
        """Stop the loop gracefully"""
        print("🛑 Stopping Singularity Loop...")
        self.running = False
        self.memory.save_state()
        print("✅ State saved. Goodbye!")


def main():
    """CLI entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Singularity Loop Orchestrator")
    parser.add_argument("--iterations", type=int, help="Max iterations (default: infinite)")
    parser.add_argument("--interval", type=int, default=60, help="Seconds between iterations")
    parser.add_argument("--once", action="store_true", help="Run single iteration")
    
    args = parser.parse_args()
    
    loop = SingularityLoop()
    loop.initialize()
    
    if args.once:
        loop.run_iteration()
    else:
        loop.run_continuous(max_iterations=args.iterations, interval_seconds=args.interval)


if __name__ == "__main__":
    main()
