#!/usr/bin/env python3
"""
Table Optimization - 表优化与治理工具

识别废弃表、分析小文件问题、优化 Compaction 策略。

Usage:
    python table_optimizer.py <action> [options]

Examples:
    python table_optimizer.py check_abandoned --table schema.table_name --days 30
    python table_optimizer.py check_write_history --table schema.table_name
    python table_optimizer.py check_compaction --table schema.table_name
    python table_optimizer.py check_files --table schema.table_name
    python table_optimizer.py check_partitions --table schema.table_name
"""

import argparse
import json
import sys
from typing import Dict, Any


def get_normalize_table_function_sql() -> str:
    """
    返回创建 normalize_table 函数的 SQL。
    该函数用于标准化表名，过滤 delta/incr 临时表、volume 目录、kafka pipe 等。
    """
    return """CREATE OR REPLACE FUNCTION public.normalize_table(t STRING) 
RETURNS STRING
RETURN case 
    when contains(t, '__delta__') or contains(t, '__incr__') then NULL -- remove delta/incr tables
    when contains(t, '__DIRECTORY__EXTERNAL__') then NULL -- show volume directory
    when contains(t, '_$kafka$_') then regexp_replace(t, r'([\\w\\.\\-]+)_\\$kafka\\$_\\w+', r'KAFKA.$1') -- kafka pipe
    when t rlike r'_t_\\w{32}' then regexp_replace(t, r'([\\w\\.]+)_t_\\w{32}', r'VOLUME.$1') -- volume
    else t -- as it is
    end
;"""


def check_abandoned(table_name: str, days: int = 30) -> Dict[str, Any]:
    """
    检查表是否为废弃表（近 N 天作业历史中未涉及）。
    
    Args:
        table_name: 表名（schema.table 格式）
        days: 检查的天数范围，默认 30 天
    
    Returns:
        包含前置函数 SQL 和诊断 SQL 的字典
    """
    prerequisite_sql = get_normalize_table_function_sql()
    
    diagnostic_sql = f"""WITH frow AS (
    WITH raw AS (
        SELECT 
            split(input_objects, ',') AS input, 
            split(output_objects, ',') AS output
        FROM information_schema.job_history
        WHERE start_time >= now() - INTERVAL {days} DAY
          AND output_objects IS NOT NULL
    ),
    normalized AS (
        SELECT 
            array_compact(transform(input, x -> public.normalize_table(x))) AS input,
            array_compact(transform(output, x -> public.normalize_table(x))) AS output
        FROM raw
    ),
    exploded AS (
        SELECT table_name, explode(input) AS upstream 
        FROM (
            SELECT explode(output) AS table_name, input
            FROM normalized
        )
    )
    SELECT table_name, upstream
    FROM exploded
    WHERE table_name IS NOT NULL AND table_name != '' 
      AND upstream IS NOT NULL AND upstream != ''
    GROUP BY table_name, upstream
)
SELECT COUNT(1) AS access_count
FROM frow 
WHERE LOCATE('{table_name}', table_name) > 0 
   OR LOCATE('{table_name}', upstream) > 0"""

    return {
        "status": "success",
        "action": "check_abandoned",
        "table_name": table_name,
        "days": days,
        "prerequisite_sql": prerequisite_sql,
        "diagnostic_sql": diagnostic_sql,
        "description": f"检查表 {table_name} 在近 {days} 天内是否被作业访问",
        "interpretation": "如果 access_count 返回 0，说明该表在指定时间内未被任何作业访问，属于废弃表候选"
    }


def check_write_history(table_name: str) -> Dict[str, Any]:
    """
    检查表的写入历史，判断是否长久未写入。
    
    Args:
        table_name: 表名（schema.table 格式）
    
    Returns:
        包含诊断 SQL 的字典
    """
    diagnostic_sql = f"DESC HISTORY {table_name}"
    
    return {
        "status": "success",
        "action": "check_write_history",
        "table_name": table_name,
        "diagnostic_sql": diagnostic_sql,
        "description": f"检查表 {table_name} 的写入历史",
        "interpretation": "查看最后写入时间，如果超过 30 天则属于长久未写入的表"
    }


def get_table_properties(table_name: str) -> Dict[str, Any]:
    """
    获取表属性（包括 Compaction 配置、统计信息、分区信息等）。
    
    Args:
        table_name: 表名（schema.table 格式）
    
    Returns:
        包含诊断 SQL 的字典
    """
    diagnostic_sql = f"DESC EXTENDED {table_name}"
    
    return {
        "status": "success",
        "action": "get_table_properties",
        "table_name": table_name,
        "diagnostic_sql": diagnostic_sql,
        "description": f"获取表 {table_name} 的属性",
        "interpretation": """检查返回结果中：
- properties 字段：是否包含 cz.compaction.min.interval 和 cz.compaction.server.ignore.latest.partition.window 配置
- statistics 字段：记录文件大小字节数（用于计算平均文件大小）
- 是否包含 '# Partition Information' 字段（判断是否为分区表）"""
    }


def check_files(table_name: str) -> Dict[str, Any]:
    """
    检查非分区表的文件数量（用于计算平均文件大小）。
    
    Args:
        table_name: 表名（schema.table 格式）
    
    Returns:
        包含诊断 SQL 的字典
    """
    diagnostic_sql = f"""SELECT COUNT(FILE__SLICE__ID) AS file_count 
FROM (
    SELECT FILE__SLICE__ID 
    FROM {table_name} 
    GROUP BY FILE__SLICE__ID
)"""
    
    return {
        "status": "success",
        "action": "check_files",
        "table_name": table_name,
        "diagnostic_sql": diagnostic_sql,
        "description": f"检查表 {table_name} 的文件数量",
        "interpretation": "结合 DESC EXTENDED 中的 statistics 字段计算：avg_file_size = totalSize / file_count，如果 < 64MB 则存在小文件问题"
    }


def check_partitions(table_name: str) -> Dict[str, Any]:
    """
    检查分区表的文件分布情况。
    
    Args:
        table_name: 表名（schema.table 格式）
    
    Returns:
        包含诊断 SQL 的字典
    """
    diagnostic_sql = f"""WITH raw AS (
    SELECT 
        partitions AS dtm, 
        * 
    FROM (SHOW PARTITIONS EXTENDED {table_name})
),
d AS (
    SELECT 
        dtm, 
        SUM(total_rows) / 100000000 AS total_rows_e, 
        SUM(bytes) AS sum_bytes,
        ROUND(sum_bytes / 1024 / 1024 / 1024 / 1024, 2) AS size_tb, 
        SUM(total_files) AS sum_files,
        ROUND(sum_bytes / sum_files / 1024 / 1024, 2) AS avg_file_size_mb
    FROM raw
    GROUP BY dtm
)
SELECT dtm, total_rows_e, size_tb, sum_files, avg_file_size_mb 
FROM d
ORDER BY dtm DESC"""
    
    return {
        "status": "success",
        "action": "check_partitions",
        "table_name": table_name,
        "diagnostic_sql": diagnostic_sql,
        "description": f"检查分区表 {table_name} 的文件分布",
        "interpretation": """检查返回结果中：
- avg_file_size_mb < 64 且文件数量较大 → 存在小文件问题
- dtm 格式判断分区粒度：
  - 天分区：2024-01-01
  - 小时分区：2024-01-01-12
  - 分钟分区：2024-01-01-12-30"""
    }


def get_optimization_sql(table_name: str, optimization_type: str, 
                         min_interval: int = None, 
                         partition_window: int = None,
                         lifecycle: int = None) -> Dict[str, Any]:
    """
    获取优化建议的 SQL。
    
    Args:
        table_name: 表名（schema.table 格式）
        optimization_type: 优化类型 (lifecycle, compaction_daily, compaction_hourly)
        min_interval: cz.compaction.min.interval 的值（秒）
        partition_window: cz.compaction.server.ignore.latest.partition.window 的值（秒）
        lifecycle: data_lifecycle 的值（天）
    
    Returns:
        包含优化 SQL 的字典
    """
    if optimization_type == "lifecycle":
        lifecycle_val = lifecycle if lifecycle is not None else 30
        sql = f"ALTER TABLE {table_name} SET TBLPROPERTIES ('data_lifecycle'='{lifecycle_val}')"
        description = f"设置表生命周期为 {lifecycle_val} 天"
    elif optimization_type == "compaction_daily":
        interval_val = min_interval if min_interval is not None else 1800
        sql = f"ALTER TABLE {table_name} SET TBLPROPERTIES ('cz.compaction.strategy' = 'dml', 'cz.compaction.min.interval' = '{interval_val}')"
        description = f"配置 DML 模式 Compaction：strategy=dml，min.interval={interval_val}秒"
    elif optimization_type == "compaction_hourly":
        interval_val = min_interval if min_interval is not None else 1800
        window_val = partition_window if partition_window is not None else 3600
        sql = f"ALTER TABLE {table_name} SET TBLPROPERTIES ('cz.compaction.strategy' = 'dml|background', 'cz.compaction.min.interval' = '{interval_val}', 'cz.compaction.server.ignore.latest.partition.window' = '{window_val}')"
        description = f"配置 DML+Background 模式 Compaction：strategy=dml|background，min.interval={interval_val}秒，ignore.latest.partition.window={window_val}秒"
    else:
        return {
            "status": "error",
            "message": f"未知的优化类型: {optimization_type}，支持: lifecycle, compaction_daily, compaction_hourly"
        }
    
    return {
        "status": "success",
        "action": "optimize",
        "table_name": table_name,
        "optimization_type": optimization_type,
        "optimization_sql": sql,
        "description": description,
        "warning": "ALTER TABLE 操作会影响表属性，执行前需用户确认"
    }


def main():
    parser = argparse.ArgumentParser(
        description="Table Optimization - 表优化与治理工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例用法:
  %(prog)s check_abandoned --table schema.table_name --days 30
  %(prog)s check_write_history --table schema.table_name
  %(prog)s check_compaction --table schema.table_name
  %(prog)s check_files --table schema.table_name
  %(prog)s check_partitions --table schema.table_name
  %(prog)s optimize --table schema.table_name --type lifecycle

输出的 SQL 可通过 MCP Server 的 LH_execute_query 工具执行。
        """
    )
    
    subparsers = parser.add_subparsers(dest="action", help="操作类型")
    
    # check_abandoned 子命令
    abandoned_parser = subparsers.add_parser(
        "check_abandoned", 
        help="检查表是否为废弃表（近 N 天作业历史中未涉及）"
    )
    abandoned_parser.add_argument(
        "--table", type=str, required=True,
        help="表名（schema.table 格式）"
    )
    abandoned_parser.add_argument(
        "--days", type=int, default=30,
        help="检查的天数范围，默认 30 天"
    )
    
    # check_write_history 子命令
    write_parser = subparsers.add_parser(
        "check_write_history",
        help="检查表的写入历史"
    )
    write_parser.add_argument(
        "--table", type=str, required=True,
        help="表名（schema.table 格式）"
    )
    
    # get_table_properties 子命令
    properties_parser = subparsers.add_parser(
        "get_table_properties",
        help="获取表属性（包括 Compaction 配置、统计信息、分区信息等）"
    )
    properties_parser.add_argument(
        "--table", type=str, required=True,
        help="表名（schema.table 格式）"
    )
    
    # check_files 子命令
    files_parser = subparsers.add_parser(
        "check_files",
        help="检查非分区表的文件数量"
    )
    files_parser.add_argument(
        "--table", type=str, required=True,
        help="表名（schema.table 格式）"
    )
    
    # check_partitions 子命令
    partitions_parser = subparsers.add_parser(
        "check_partitions",
        help="检查分区表的文件分布"
    )
    partitions_parser.add_argument(
        "--table", type=str, required=True,
        help="表名（schema.table 格式）"
    )
    
    # optimize 子命令
    optimize_parser = subparsers.add_parser(
        "optimize",
        help="获取优化建议的 SQL"
    )
    optimize_parser.add_argument(
        "--table", type=str, required=True,
        help="表名（schema.table 格式）"
    )
    optimize_parser.add_argument(
        "--type", type=str, required=True,
        choices=["lifecycle", "compaction_daily", "compaction_hourly"],
        help="优化类型"
    )
    optimize_parser.add_argument(
        "--min-interval", type=int, default=None,
        help="cz.compaction.min.interval 的值（秒），默认 1800"
    )
    optimize_parser.add_argument(
        "--partition-window", type=int, default=None,
        help="cz.compaction.server.ignore.latest.partition.window 的值（秒），默认 3600"
    )
    optimize_parser.add_argument(
        "--lifecycle", type=int, default=None,
        help="data_lifecycle 的值（天），默认 30"
    )
    
    args = parser.parse_args()
    
    if not args.action:
        parser.print_help()
        sys.exit(1)
    
    # 执行对应的分析函数
    if args.action == "check_abandoned":
        result = check_abandoned(table_name=args.table, days=args.days)
    elif args.action == "check_write_history":
        result = check_write_history(table_name=args.table)
    elif args.action == "get_table_properties":
        result = get_table_properties(table_name=args.table)
    elif args.action == "check_files":
        result = check_files(table_name=args.table)
    elif args.action == "check_partitions":
        result = check_partitions(table_name=args.table)
    elif args.action == "optimize":
        result = get_optimization_sql(
            table_name=args.table, 
            optimization_type=args.type,
            min_interval=args.min_interval,
            partition_window=args.partition_window,
            lifecycle=args.lifecycle
        )
    else:
        print(f"未知操作: {args.action}", file=sys.stderr)
        sys.exit(1)
    
    # 输出结果
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
