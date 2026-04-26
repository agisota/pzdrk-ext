#!/usr/bin/env python3
"""
Agent Monitor — Performance Tracking & Health Monitoring

Tracks:
- Agent execution metrics (success rate, latency, errors)
- System health (memory, CPU, disk)
- Performance trends over time
- Anomaly detection
"""

import json
import psutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional
from collections import defaultdict, deque


class AgentMonitor:
    """Monitors agent performance and system health"""
    
    def __init__(self, memory_manager):
        self.memory = memory_manager
        self.performance_file = memory_manager.memory_dir / "agent_performance.json"
        
        # In-memory metrics
        self.metrics: Dict[str, List[Dict]] = defaultdict(list)
        self.recent_metrics = deque(maxlen=100)  # Last 100 data points
        
        # Thresholds for health checks
        self.thresholds = {
            "cpu_percent": 80.0,
            "memory_percent": 85.0,
            "disk_percent": 90.0,
            "error_rate": 0.2,  # 20% error rate
            "avg_latency_ms": 5000  # 5 seconds
        }
        
        # Load existing performance data
        self._load_performance_data()
    
    def _load_performance_data(self):
        """Load performance data from disk"""
        if self.performance_file.exists():
            with open(self.performance_file) as f:
                data = json.load(f)
                self.metrics = defaultdict(list, data.get("metrics", {}))
    
    def record_iteration_metrics(self, metrics: Dict):
        """Record metrics from an iteration"""
        timestamp = datetime.utcnow().isoformat()
        
        # Add timestamp
        metrics["timestamp"] = timestamp
        
        # Store in memory
        self.metrics["iterations"].append(metrics)
        self.recent_metrics.append(metrics)
        
        # Save to disk periodically (every 10 iterations)
        if len(self.metrics["iterations"]) % 10 == 0:
            self._save_performance_data()
    
    def record_agent_execution(self, agent_name: str, success: bool, duration_ms: float, error: Optional[str] = None):
        """Record individual agent execution"""
        execution_record = {
            "timestamp": datetime.utcnow().isoformat(),
            "agent": agent_name,
            "success": success,
            "duration_ms": duration_ms,
            "error": error
        }
        
        self.metrics["agent_executions"].append(execution_record)
        self.recent_metrics.append(execution_record)
    
    def get_system_health(self) -> Dict[str, Any]:
        """Get current system health status"""
        # System metrics
        cpu_percent = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        
        # Calculate agent metrics
        agent_stats = self._calculate_agent_stats()
        
        # Determine health status
        issues = []
        needs_maintenance = False
        
        if cpu_percent > self.thresholds["cpu_percent"]:
            issues.append(f"High CPU usage: {cpu_percent:.1f}%")
            needs_maintenance = True
        
        if memory.percent > self.thresholds["memory_percent"]:
            issues.append(f"High memory usage: {memory.percent:.1f}%")
            needs_maintenance = True
        
        if disk.percent > self.thresholds["disk_percent"]:
            issues.append(f"High disk usage: {disk.percent:.1f}%")
            needs_maintenance = True
        
        if agent_stats["error_rate"] > self.thresholds["error_rate"]:
            issues.append(f"High error rate: {agent_stats['error_rate']:.1%}")
            needs_maintenance = True
        
        # Maintenance actions
        maintenance_actions = []
        if needs_maintenance:
            if cpu_percent > self.thresholds["cpu_percent"]:
                maintenance_actions.append("reduce_parallelism")
            if memory.percent > self.thresholds["memory_percent"]:
                maintenance_actions.append("clear_caches")
            if disk.percent > self.thresholds["disk_percent"]:
                maintenance_actions.append("cleanup_old_logs")
            if agent_stats["error_rate"] > self.thresholds["error_rate"]:
                maintenance_actions.append("review_error_logs")
        
        return {
            "status": "unhealthy" if needs_maintenance else "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "system": {
                "cpu_percent": cpu_percent,
                "memory_percent": memory.percent,
                "memory_available_gb": memory.available / (1024**3),
                "disk_percent": disk.percent,
                "disk_free_gb": disk.free / (1024**3)
            },
            "agents": agent_stats,
            "issues": issues,
            "needs_maintenance": needs_maintenance,
            "maintenance_actions": maintenance_actions
        }
    
    def _calculate_agent_stats(self) -> Dict:
        """Calculate aggregate agent statistics"""
        if not self.metrics["agent_executions"]:
            return {
                "total_executions": 0,
                "success_rate": 0.0,
                "error_rate": 0.0,
                "avg_duration_ms": 0.0
            }
        
        executions = self.metrics["agent_executions"]
        recent = executions[-100:]  # Last 100 executions
        
        total = len(recent)
        successful = sum(1 for e in recent if e["success"])
        
        return {
            "total_executions": total,
            "success_rate": successful / total if total > 0 else 0.0,
            "error_rate": (total - successful) / total if total > 0 else 0.0,
            "avg_duration_ms": sum(e["duration_ms"] for e in recent) / total if total > 0 else 0.0
        }
    
    def get_performance_trends(self, hours: int = 24) -> Dict:
        """Get performance trends over time"""
        cutoff = datetime.utcnow() - timedelta(hours=hours)
        cutoff_iso = cutoff.isoformat()
        
        # Filter recent iterations
        recent_iterations = [
            m for m in self.metrics["iterations"]
            if m.get("timestamp", "") >= cutoff_iso
        ]
        
        if not recent_iterations:
            return {
                "period_hours": hours,
                "data_points": 0,
                "trends": {}
            }
        
        # Calculate trends
        success_rates = [m.get("success_rate", 0) for m in recent_iterations]
        
        return {
            "period_hours": hours,
            "data_points": len(recent_iterations),
            "trends": {
                "avg_success_rate": sum(success_rates) / len(success_rates) if success_rates else 0,
                "min_success_rate": min(success_rates) if success_rates else 0,
                "max_success_rate": max(success_rates) if success_rates else 0,
                "total_iterations": len(recent_iterations)
            }
        }
    
    def detect_anomalies(self) -> List[Dict]:
        """Detect anomalies in recent metrics"""
        anomalies = []
        
        if len(self.recent_metrics) < 10:
            return anomalies  # Not enough data
        
        # Calculate baseline from recent metrics
        recent_list = list(self.recent_metrics)
        
        # Check for sudden drops in success rate
        if len(recent_list) >= 5:
            recent_success = [m.get("success_rate", 1.0) for m in recent_list[-5:]]
            baseline_success = [m.get("success_rate", 1.0) for m in recent_list[-20:-5]]
            
            if baseline_success:
                avg_baseline = sum(baseline_success) / len(baseline_success)
                avg_recent = sum(recent_success) / len(recent_success)
                
                if avg_recent < avg_baseline * 0.5:  # 50% drop
                    anomalies.append({
                        "type": "success_rate_drop",
                        "severity": "high",
                        "message": f"Success rate dropped from {avg_baseline:.1%} to {avg_recent:.1%}",
                        "detected_at": datetime.utcnow().isoformat()
                    })
        
        return anomalies
    
    def get_agent_leaderboard(self, limit: int = 10) -> List[Dict]:
        """Get top performing agents"""
        if not self.metrics["agent_executions"]:
            return []
        
        # Group by agent
        agent_stats = defaultdict(lambda: {"successes": 0, "failures": 0, "total_duration": 0.0})
        
        for execution in self.metrics["agent_executions"]:
            agent = execution["agent"]
            if execution["success"]:
                agent_stats[agent]["successes"] += 1
            else:
                agent_stats[agent]["failures"] += 1
            agent_stats[agent]["total_duration"] += execution["duration_ms"]
        
        # Calculate scores
        leaderboard = []
        for agent, stats in agent_stats.items():
            total = stats["successes"] + stats["failures"]
            success_rate = stats["successes"] / total if total > 0 else 0
            avg_duration = stats["total_duration"] / total if total > 0 else 0
            
            leaderboard.append({
                "agent": agent,
                "success_rate": success_rate,
                "total_executions": total,
                "avg_duration_ms": avg_duration
            })
        
        # Sort by success rate descending
        leaderboard.sort(key=lambda x: x["success_rate"], reverse=True)
        
        return leaderboard[:limit]
    
    def _save_performance_data(self):
        """Save performance data to disk"""
        data = {
            "last_updated": datetime.utcnow().isoformat(),
            "metrics": dict(self.metrics)
        }
        
        with open(self.performance_file, "w") as f:
            json.dump(data, f, indent=2)
    
    def generate_report(self) -> str:
        """Generate human-readable performance report"""
        health = self.get_system_health()
        trends = self.get_performance_trends(hours=24)
        anomalies = self.detect_anomalies()
        leaderboard = self.get_agent_leaderboard(limit=5)
        
        report = []
        report.append("# Agent Performance Report")
        report.append(f"\n**Generated:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}\n")
        
        # System Health
        report.append("## System Health")
        report.append(f"**Status:** {health['status'].upper()}")
        report.append(f"- CPU: {health['system']['cpu_percent']:.1f}%")
        report.append(f"- Memory: {health['system']['memory_percent']:.1f}%")
        report.append(f"- Disk: {health['system']['disk_percent']:.1f}%")
        
        if health['issues']:
            report.append("\n**Issues:**")
            for issue in health['issues']:
                report.append(f"- ⚠️ {issue}")
        
        # Performance Trends
        report.append("\n## Performance Trends (24h)")
        report.append(f"- Data Points: {trends['data_points']}")
        if trends['data_points'] > 0:
            report.append(f"- Avg Success Rate: {trends['trends']['avg_success_rate']:.1%}")
            report.append(f"- Total Iterations: {trends['trends']['total_iterations']}")
        
        # Anomalies
        if anomalies:
            report.append("\n## Anomalies Detected")
            for anomaly in anomalies:
                report.append(f"- 🚨 {anomaly['message']}")
        
        # Leaderboard
        if leaderboard:
            report.append("\n## Top Agents")
            for i, agent in enumerate(leaderboard, 1):
                report.append(f"{i}. **{agent['agent']}** — {agent['success_rate']:.1%} success ({agent['total_executions']} runs)")
        
        return "\n".join(report)
