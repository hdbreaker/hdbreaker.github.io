---
title: "CVE-2019-14670 - LimeSurvey TCPDF RCE via PHAR File"
publishDate: "2019-03-25"
description: "Remote code execution in LimeSurvey < 3.17 through TCPDF PHAR deserialization attack, exploiting queXML PDF export functionality."
tags: ["rce", "php", "serialization", "tcpdf", "limesurvey", "phar", "object-injection", "cve-2019-14670"]
draft: false
---



During our security research on LimeSurvey, we discovered a critical vulnerability that allows remote code execution by exploiting a deserialization flaw in the TCPDF library. 

The attack vector presented here leverages the **"Unserialization via phar:// Stream Wrapper"** technique, originally researched by **Sam Thomas** and presented at **Black Hat USA 2018**. The method demonstrates how to trigger PHP object injection without directly controlling an `unserialize()` function call.

## Technical Background

### Understanding TCPDF

TCPDF is an open-source PHP library for generating PDF documents from HTML code. When generating a PDF document from HTML content, it's possible to control the input of vulnerable functions through tags like `<img>`.

![Bug Discovery Point](/assets/blog/bug_spot.png)
*Vulnerability discovery point in TCPDF image processing functionality*

### Unserialization via phar:// stream wrapper

This exploitation technique is called **Unserialization via the phar:// stream wrapper**. A PHAR file can contain metadata, which can include serialized PHP objects.

PHP functions such as:
- `file_exists()`
- `fopen()`
- `filesize()`
- `copy()`
- `include()`

Support the use of the `phar://` wrapper. When these functions make a call to a PHAR file through this wrapper, the file's metadata is automatically deserialized, allowing injection of malicious objects **without needing to control an `unserialize()` function**.

## Vulnerability Analysis

### Requirements for Exploitation

1. **Control input** to any of the mentioned vulnerable functions
2. **Ability to upload** a PHAR file to the server
3. **Administrator access** in LimeSurvey for PDF export functionality

### LimeSurvey and TCPDF

LimeSurvey < 3.17 uses an outdated version (6.2.13) of the TCPDF library that is vulnerable to deserialization attacks through the `phar://` wrapper.

## Step-by-Step Exploitation

The vulnerability can be exploited through LimeSurvey's queXML PDF export functionality by injecting a malicious PHAR file via the style configuration.

### Step 1: Generate and Upload Malicious PHAR File

First, generate the malicious PHAR file using **PHPGGC** with the Yii framework gadget chain:

```bash
$ ./phpggc Yii/RCE1 system "ls" -p phar -o /tmp/exploit.jpg
```

This command will:
- Use the **Yii/RCE1** gadget chain (since LimeSurvey uses Yii framework)
- Execute the `ls` command on the remote server
- Generate a PHAR file (`-p phar`)
- Output the malicious file as `/tmp/exploit.jpg` (`-o`)

The generated `exploit.jpg` file is actually a PHAR archive containing serialized PHP objects that will execute the `ls` command when deserialized.

Then navigate to **Email templates** section and upload the malicious PHAR file (`exploit.jpg`).

![Step 1 - Upload PHAR File](/assets/blog/step1.png)
*Uploading the malicious PHAR file through LimeSurvey's file upload*


### Step 2: Navigate to queXML PDF Export

Go to **Overview > Display/Export > queXML PDF export > Export**.

### Step 3: Inject PHAR Wrapper

Insert the following HTML code in the **"Style"** field:

```html
<h1>pwned</h1><img src="phar://./upload/surveys/{SURVEYID}/files/exploit.jpg">
```

**Important**: Replace `{SURVEYID}` with the actual survey ID from your LimeSurvey installation.

![Step 3 - Inject PHAR Payload](/assets/blog/step3.png)
*Injecting the PHAR wrapper payload through LimeSurvey's queXML PDF export style field*

### Step 4: Trigger Exploitation

Click on the **"queXML PDF export"** button to trigger the vulnerability.

When TCPDF processes the HTML content, it will attempt to load the image via the `phar://` wrapper, automatically deserializing the malicious metadata and executing the embedded payload (in this case, the `ls` command).

![Step 4 - Execute Exploit](/assets/blog/step4.png)
*Triggering the PHAR deserialization through PDF export*


## Impact Assessment

### Potential Consequences

1. **Complete Server Compromise**: Full system access through web shell
2. **Data Exfiltration**: Access to survey responses and user data
3. **Privilege Escalation**: Potential for lateral movement in network
4. **Persistent Access**: Ability to install backdoors for continued access
5. **Survey Manipulation**: Ability to modify survey data and results

## Remediation Steps

### Immediate Actions

1. **Update LimeSurvey**: Upgrade to version 3.17 or later
2. **Update TCPDF**: Ensure TCPDF library is updated to latest secure version
3. **Disable PHAR**: Add `phar.readonly = On` to php.ini if PHAR functionality isn't needed
4. **Input Validation**: Implement strict validation for user-supplied content

### Long-term Security Measures

```apache
# Apache .htaccess protection
<IfModule mod_rewrite.c>
    RewriteEngine On
    
    # Block PHAR wrapper in requests
    RewriteCond %{QUERY_STRING} phar:// [NC,OR]
    RewriteCond %{REQUEST_URI} phar:// [NC,OR]
    RewriteCond %{HTTP_REFERER} phar:// [NC]
    RewriteRule .* - [F,L]
    
    # Block other dangerous wrappers
    RewriteCond %{QUERY_STRING} (php|file|data):// [NC]
    RewriteRule .* - [F,L]
</IfModule>

# Block PHAR file uploads
<FilesMatch "\.(phar|pht)$">
    Order allow,deny
    Deny from all
</FilesMatch>
```

### Nginx protection

```nginx

location ~ ^.*(phar|php|file|data):// {
    return 403;
}

# Block PHAR file access
location ~* \.(phar|pht)$ {
    deny all;
}

# Filter dangerous content in POST data
if ($request_body ~ "phar://") {
    return 403;
}
```
