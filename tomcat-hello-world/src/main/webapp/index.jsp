<%@ page language="java" contentType="text/html; charset=UTF-8" pageEncoding="UTF-8"%>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Tomcat Hello World on OpenShift</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
        .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 2px solid #3b82d4; padding-bottom: 10px; }
        .info { background: #e8f4fd; padding: 15px; border-radius: 4px; margin: 20px 0; }
        .info p { margin: 5px 0; }
        .label { font-weight: bold; color: #555; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎉 Tomcat Hello World on OpenShift!</h1>
        <div class="info">
            <p><span class="label">Pod Name:</span> ${pageContext.request.getServerName()}</p>
            <p><span class="label">Pod IP:</span> ${pageContext.request.getLocalAddr()}</p>
            <p><span class="label">Server Port:</span> ${pageContext.request.getLocalPort()}</p>
            <p><span class="label">Java Version:</span> ${System.getProperty("java.version")}</p>
            <p><span class="label">Tomcat Version:</span> ${application.getServerInfo()}</p>
            <p><span class="label">Timestamp:</span> <%= new java.util.Date() %></p>
        </div>
        <p>This is a minimal Tomcat web application deployed via OpenShift S2I (Source-to-Image).</p>
        <p><small>Deployed from: <a href="https://github.com/openshift/openshift-jee-sample">OpenShift JEE Sample</a> pattern</small></p>
    </div>
</body>
</html>