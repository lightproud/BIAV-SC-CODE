#!/usr/bin/env python3
"""
忘却前夜 报告系统 - 本地定时任务
每天 UTC+8 00:00 自动运行收集+报告生成，无需 GitHub Actions。

使用方式:
  python scripts/scheduler.py          # 前台运行
  nohup python scripts/scheduler.py &  # 后台运行 (Linux/Mac)

也可以用系统自带的定时任务:
  Linux/Mac crontab:
    0 0 * * * cd /path/to/report-system && python scripts/run_all.py
  Windows 任务计划程序:
    触发器: 每天 00:00
    操作: python /path/to/report-system/scripts/run_all.py
"""

import time
import logging
from datetime import datetime, timezone, timedelta

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("scheduler")

# UTC+8 时区
UTC8 = timezone(timedelta(hours=8))

# 每天几点运行 (UTC+8)
RUN_HOUR = 0
RUN_MINUTE = 0


def next_run_time():
    """计算下一次运行时间。"""
    now = datetime.now(UTC8)
    target = now.replace(hour=RUN_HOUR, minute=RUN_MINUTE, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    return target


def run_task():
    """执行收集 + 报告生成。"""
    from collector import collect_all
    from reporter import generate_report

    logger.info("=== 开始执行定时任务 ===")
    try:
        collect_all()
        generate_report()
        logger.info("=== 定时任务完成 ===")
    except Exception as e:
        logger.error(f"任务执行失败: {e}")


def main():
    logger.info("忘却前夜 报告系统 - 本地定时任务已启动")
    logger.info(f"每天 UTC+8 {RUN_HOUR:02d}:{RUN_MINUTE:02d} 自动运行")

    while True:
        target = next_run_time()
        now = datetime.now(UTC8)
        wait_seconds = (target - now).total_seconds()

        logger.info(f"下次运行: {target.strftime('%Y-%m-%d %H:%M')} (UTC+8), 等待 {wait_seconds/3600:.1f} 小时")

        time.sleep(wait_seconds)
        run_task()

        # 运行完等 60 秒，避免同一分钟内重复触发
        time.sleep(60)


if __name__ == "__main__":
    main()
