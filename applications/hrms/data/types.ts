export interface HrmsCredential {
  username: string;
  password: string;
  name: string;
}

// Three isolated employee identities so parallel test files (leave.spec.ts,
// approval.spec.ts, leave-api.spec.ts) never contend over the same
// employee's leave-request state on the shared in-memory HRMS backend.
export interface HrmsDataProfile {
  employee: HrmsCredential;
  employeeTwo: HrmsCredential;
  employeeThree: HrmsCredential;
  manager: HrmsCredential;
}
