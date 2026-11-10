---
name: data-analysis
description: Analyses a CSV, JSON, Excel or SQLite dataset with a reproducible pandas or Node script. Profiles data quality first, reports only numbers from the script output, saves PNG charts and states caveats. Use when the user asks for answers, statistics or charts from a data file.
argument-hint: "<the question, and the data file if known>"
metadata:
  dahl-mode: build
  dahl-icon: chart
---

# Data analysis

Question: $ARGUMENTS

If the question above is empty, find the data files (step 2) and call `ask_user` once with 2 to 4 concrete questions the data can answer (for example "monthly revenue trend", "top 10 customers"), then continue.

## When to use
- "What does this CSV say about X?", "which channel converts best?", "plot sales by month".
- Profiling a dataset for quality (missing values, duplicates, outliers) before using it.

## When not to use
- Slow database queries in the app: use `slow-queries` (call `use_skill`).
- Changing the database schema: use `db-migration`.
- Research that needs outside sources: use `research`.
- Building a dashboard UI in the app: use `ui`.

## Mode
Needs Build mode (writes and runs scripts). In Plan or Review mode, do steps 2 and 3 (locate and read the head of the data), report the schema, visible quality problems and the analysis plan, and ask the user to switch to Build. Do not compute results by hand in Plan mode.

## Checklist
1. `update_plan` with: locate data, check tools, profile, analyse, charts, report.
2. Locate the data: `list_dir` and `search` (glob `**/*.{csv,tsv,json,jsonl,xlsx,xls,parquet,sqlite,db}`). Read only the head of large files: `read_file` with `start_line` 1 and `end_line` 20. Note delimiter, header row, date formats, decimal separator, encoding hints.
3. Pin down the question: the metric, the grouping, the time range and the filter. If two readings are plausible (revenue with or without refunds, calendar or fiscal year), `ask_user`.
4. Check tooling with `run_command`: `python --version` (or `py -3 --version`) and `python -c "import pandas, matplotlib; print(pandas.__version__)"`. If missing, ask before installing: `python -m pip install pandas matplotlib openpyxl` (openpyxl for Excel), preferably in a venv (`python -m venv .venv; .venv/Scripts/python -m pip install pandas matplotlib`). Without Python, use a Node script for JSON and simple CSV (no quoted commas); otherwise ask.
5. Profile first, in `analysis/profile.py` (or the project's analysis folder), and run it:
   - Rows and columns, dtypes, nulls per column, duplicate rows (and duplicate ids), distinct counts for categorical columns, min and max for numeric and date columns, values that fail to parse (`pd.to_numeric(errors="coerce")`, `pd.to_datetime(errors="coerce")`), negative or impossible values.
   - Loading tips: `pd.read_csv(path, encoding="utf-8-sig")` for Excel-exported CSV; `sep=";", decimal=","` for European CSV; `pd.read_json(path, lines=True)` for JSON Lines; `pd.read_excel(path, sheet_name=None)` to list sheets; SQLite with `sqlite3.connect(path)` and `pd.read_sql("select name from sqlite_master where type='table'", con)`.
6. Decide how to handle each quality problem (drop, dedupe, fill, exclude a period) and write the decision and the affected row counts into the script output.
7. Analysis script `analysis/analyze.py`:
   - Reproducible: relative paths, no manual steps, fixed random seed if sampling, does not modify the source data.
   - Prints every number you will report, with a label (`print(f"top_category={name} revenue={value:.2f}")`), plus row counts after each filter.
   - Charts only when they help: `import matplotlib; matplotlib.use("Agg")`, one message per chart, title, axis labels with units, `fig.savefig("analysis/out/<name>.png", dpi=150, bbox_inches="tight")`. Create the folder with `os.makedirs(..., exist_ok=True)`.
   - Run it with `run_command` (`python analysis/analyze.py`) and read the full output.
8. Check one or two results a second way (a different grouping that must sum to the same total, or a quick count) to catch filter mistakes.
9. Look at each chart with `view_image` or `analyze_image` to confirm it shows what you claim.

## Verify (required before saying done)
- The script runs from a clean start with exit code 0 (show the command).
- Every number in the answer appears in the captured script output. No number may come from mental arithmetic or memory.
- Chart files exist (`list_dir analysis/out`) and were inspected.
- The source data file is unchanged.
- State what is not verified (for example, whether duplicates are real repeat orders or export errors).

## Output
- **Answer:** the direct answer in one or two sentences with the key numbers.
- **Data:** file, rows used of rows total, time range, columns used.
- **Quality:** problems found and how each was handled (row counts).
- **Results:** table of the main figures.
- **Charts:** PNG paths with one line each on what they show.
- **Caveats:** sample size, missing data, outliers, correlation versus causation.
- **Reproduce:** the command to rerun the analysis.

## Pitfalls
- Reporting numbers before profiling; silent nulls and duplicates change totals.
- Inventing or rounding numbers that are not in the output.
- Forgetting a filter the question implies (a year, a status such as "paid only").
- Treating a difference between small groups as meaningful; give the group sizes.
- Writing derived files over the source data.
- `plt.show()` in a headless run; save to PNG instead.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
