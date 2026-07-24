import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LoginCredential {
  username: string;
  password: string;
}

const CREDENTIAL_SCRIPT = String.raw`
$Target = $env:FLOWACCOUNT_CRED_TARGET_READ
$source = @'
using System;
using System.Runtime.InteropServices;
public static class CodexCredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr credentialPtr);
}
'@
Add-Type -TypeDefinition $source
$ptr = [IntPtr]::Zero
if (-not [CodexCredentialReader]::CredRead($Target, 1, 0, [ref]$ptr)) { exit 2 }
try {
  $cred = [Runtime.InteropServices.Marshal]::PtrToStructure(
    $ptr, [type][CodexCredentialReader+CREDENTIAL]
  )
  $password = if ($cred.CredentialBlobSize -gt 0) {
    [Runtime.InteropServices.Marshal]::PtrToStringUni(
      $cred.CredentialBlob, [int]($cred.CredentialBlobSize / 2)
    )
  } else { "" }
  [pscustomobject]@{ username = $cred.UserName; password = $password } |
    ConvertTo-Json -Compress
} finally {
  [CodexCredentialReader]::CredFree($ptr)
}
`;

const CREDENTIAL_PROMPT_SCRIPT = String.raw`
$Target = $env:FLOWACCOUNT_CRED_TARGET_READ
Add-Type -AssemblyName PresentationFramework
$message = "ไม่พบข้อมูล FlowAccount ใน Windows Credential Manager." +
  [Environment]::NewLine + [Environment]::NewLine +
  "ต้องการเปิด Credential Manager เพื่อเพิ่ม Generic Credential ชื่อ '$Target' หรือไม่?"
$title = "FlowAccount MCP"
$answer = [System.Windows.MessageBox]::Show(
  $message,
  $title,
  [System.Windows.MessageBoxButton]::YesNo,
  [System.Windows.MessageBoxImage]::Question
)
if ($answer -eq [System.Windows.MessageBoxResult]::Yes) {
  Start-Process -FilePath "control.exe" -ArgumentList "/name","Microsoft.CredentialManager"
  Write-Output "YES"
} else {
  Write-Output "NO"
}
`;

export async function readWindowsCredential(
  target: string
): Promise<LoginCredential | null> {
  if (process.platform !== "win32" || !target) return null;

  const encoded = Buffer.from(CREDENTIAL_SCRIPT, "utf16le").toString("base64");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, FLOWACCOUNT_CRED_TARGET_READ: target },
      }
    );
    const parsed = JSON.parse(stdout.trim()) as Partial<LoginCredential>;
    if (!parsed.username || !parsed.password) return null;
    return { username: parsed.username, password: parsed.password };
  } catch {
    return null;
  }
}

export async function promptToOpenCredentialManager(
  target: string
): Promise<boolean> {
  if (process.platform !== "win32" || !target) return false;

  const encoded = Buffer.from(CREDENTIAL_PROMPT_SCRIPT, "utf16le").toString("base64");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-STA", "-EncodedCommand", encoded],
      {
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, FLOWACCOUNT_CRED_TARGET_READ: target },
      }
    );
    return stdout.trim().endsWith("YES");
  } catch {
    return false;
  }
}

export async function waitForWindowsCredential(
  target: string,
  timeoutMs: number
): Promise<LoginCredential | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const credential = await readWindowsCredential(target);
    if (credential) return credential;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}
