# Salary increments

*People → Salary increments* records every change to an employee's monthly salary — increments,
promotions, adjustments and decreases — with the month it starts, who proposed and approved it, and a
letter for the employee.

## How it works

1. **Propose.** From an employee's *Salary* tab (*Revise salary*), or for many people at once from
   *Salary increments → Employees* (select, *Change salary*: one percentage or amount for everyone,
   adjustable per person). Choose the month the new salary starts — this month or later.
2. **Approve.** Proposals wait in *Salary increments → To approve*; approve or decline one by one or
   all selected. Whoever may approve can also *Approve now* while proposing.
3. **In effect from its month.** The employee's salary (and, for a promotion, their designation)
   switches over when that month starts. Payroll always uses the salary of the slip's own month, so a
   raise from November never changes an October slip generated late.
4. **Letter.** Each approved change gets a numbered letter (`INC-YYMM-####`) to print, signed with the
   signatory set in the company profile. Employees see their letters on *My profile* and are notified.

## Rules

- One proposal waiting per employee at a time.
- Nobody proposes or approves their own salary (a Super Admin excepted).
- Changes stay in date order: a change cannot start before an approved change still to come — cancel
  that one first. An approved change can be cancelled until its month starts.
- No back-dating: a change starts this month or later. Pay arrears as an earning on the next salary
  slip. Approving a change for a month whose slip already exists warns that the slip keeps the old
  salary.
- Editing the salary on the employee form is recorded in the history too, and is refused while an
  approved change is still to come.
- The *Employees* view lists who has gone longest without a change; 12 months or more is flagged
  *due for review*.

## Permissions

| Permission | Default | |
|---|---|---|
| `hr.salary.revise` | Manager | Propose changes, see salaries in Salary increments |
| `hr.salary.approve` | Super Admin | Approve, decline and cancel changes |

Grant either through custom roles or individual permissions (*People → Roles*).

## Code

`lib/hr/salaryRevisions.js` (rules, salary of a month, applying due changes) · model `SalaryRevision` ·
`app/api/salary-revisions/` · `app/admin/salary-increments/` · `components/admin/salary/`,
`components/admin/employees/EmployeeSalaryTab.jsx`. Payroll (`app/api/salary/route.js`) asks
`salaryForPeriod()` for each slip.
