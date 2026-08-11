package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestComputeAssetVersionUsesLPKVersionAndContentRevision(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.yml"), []byte("version: 1.0.0\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(package.yml) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, ".lpk-version"), []byte("2.3.4+build.5\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(.lpk-version) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, contentRevisionFileName), []byte(strings.Repeat("a", 64)+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", contentRevisionFileName, err)
	}

	want := "2.3.4+build.5-" + strings.Repeat("a", assetRevisionLength)
	if got := computeAssetVersion(root); got != want {
		t.Fatalf("computeAssetVersion() = %q, want %q", got, want)
	}
}

func TestComputeAssetVersionFallsBackToPackageVersion(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".lpk-version"), []byte("../../invalid\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(.lpk-version) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "package.yml"), []byte("package: example\nversion: 4.5.6-rc.1\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(package.yml) error = %v", err)
	}

	if got := computeAssetVersion(root); !strings.HasPrefix(got, "4.5.6-rc.1-") || len(strings.TrimPrefix(got, "4.5.6-rc.1-")) != assetRevisionLength {
		t.Fatalf("computeAssetVersion() = %q, want version plus content revision", got)
	}
}

func TestComputeAssetVersionUsesStableContentFallback(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "runtime", "static"), 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "runtime", "static", "main.js"), []byte("console.log('ok');"), 0o600); err != nil {
		t.Fatalf("WriteFile(main.js) error = %v", err)
	}

	first := computeAssetVersion(root)
	second := computeAssetVersion(root)
	if first != second || !strings.HasPrefix(first, "content-") {
		t.Fatalf("content fallback = %q then %q, want stable content-* version", first, second)
	}
}

func TestBuildWritesPackageVersionForRuntimeAssets(t *testing.T) {
	data, err := os.ReadFile("lzc-build.yml")
	if err != nil {
		t.Fatalf("ReadFile(lzc-build.yml) error = %v", err)
	}
	source := string(data)
	for _, want := range []string{
		`LPK_VERSION="$(awk '/^version:[[:space:]]*/ { print $2; exit }' package.yml)"`,
		`printf '%s\n' "$LPK_VERSION" > "$CONTENT_DIR/.lpk-version"`,
		`./tools/sync-ghostty-web-assets.sh --check`,
		`hash_content_file "$CONTENT_DIR/lcmd-webshell"`,
		`find "$CONTENT_DIR/runtime" -type f -print | LC_ALL=C sort`,
		`printf '%s\n' "$CONTENT_REVISION" > "$CONTENT_DIR/.lpk-content-revision"`,
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("LPK asset version build guard missing %q", want)
		}
	}
}

func TestStaticFileServerCacheHeaders(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"page.html":       "html",
		"main.js":         "console.log('ok');",
		"style.css":       "body {}",
		"data.json":       "{}",
		"app.wasm":        "\x00asm",
		"app.webmanifest": "{}",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o600); err != nil {
			t.Fatalf("WriteFile(%s) error = %v", name, err)
		}
	}

	handler := staticFileServer(root)

	tests := []struct {
		path             string
		wantCacheControl string
		wantContentType  string
	}{
		{path: "/page.html", wantCacheControl: "no-store"},
		{path: "/main.js", wantCacheControl: "no-cache", wantContentType: "text/javascript; charset=utf-8"},
		{path: "/style.css", wantCacheControl: "no-cache"},
		{path: "/data.json", wantCacheControl: "no-cache"},
		{path: "/app.wasm", wantCacheControl: "no-cache", wantContentType: "application/wasm"},
		{path: "/app.webmanifest", wantCacheControl: "no-cache", wantContentType: "application/manifest+json; charset=utf-8"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, tt.path, nil))

			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
			if cacheControl := recorder.Header().Get("Cache-Control"); cacheControl != tt.wantCacheControl {
				t.Fatalf("Cache-Control = %q, want %q", cacheControl, tt.wantCacheControl)
			}
			if tt.wantContentType != "" {
				if contentType := recorder.Header().Get("Content-Type"); contentType != tt.wantContentType {
					t.Fatalf("Content-Type = %q, want %q", contentType, tt.wantContentType)
				}
			}
		})
	}
}

func TestVersionedStaticFileServerRequiresExactVersion(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.js"), []byte("console.log('versioned');"), 0o600); err != nil {
		t.Fatalf("WriteFile(main.js) error = %v", err)
	}
	handler := versionedStaticFileServer(root, func() string { return "1.2.3" })

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/assets/1.2.3/main.js", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("versioned asset status = %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control = %q, want immutable", got)
	}

	wrongVersion := httptest.NewRecorder()
	handler.ServeHTTP(wrongVersion, httptest.NewRequest(http.MethodGet, "/assets/1.2.4/main.js", nil))
	if wrongVersion.Code != http.StatusNotFound {
		t.Fatalf("wrong version status = %d, want 404", wrongVersion.Code)
	}

	traversalRequest := httptest.NewRequest(http.MethodGet, "/assets/1.2.3/main.js", nil)
	traversalRequest.URL.Path = "/assets/1.2.3/../main.js"
	traversal := httptest.NewRecorder()
	handler.ServeHTTP(traversal, traversalRequest)
	if traversal.Code != http.StatusNotFound {
		t.Fatalf("traversal status = %d, want 404", traversal.Code)
	}
}

func TestVersionedStaticFileServerTracksLPKVersionWithoutRestart(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.js"), []byte("console.log('versioned');"), 0o600); err != nil {
		t.Fatalf("WriteFile(main.js) error = %v", err)
	}
	versionFile := filepath.Join(root, ".lpk-version")
	revisionFile := filepath.Join(root, contentRevisionFileName)
	if err := os.WriteFile(versionFile, []byte("1.0.6\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(.lpk-version) error = %v", err)
	}
	if err := os.WriteFile(revisionFile, []byte(strings.Repeat("a", 64)+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", contentRevisionFileName, err)
	}
	initialAssetVersion := "1.0.6-" + strings.Repeat("a", assetRevisionLength)
	server := &pluginServer{rootDir: root, assetVersion: initialAssetVersion}
	handler := versionedStaticFileServer(root, server.currentAssetVersion)

	before := httptest.NewRecorder()
	handler.ServeHTTP(before, httptest.NewRequest(http.MethodGet, "/assets/"+initialAssetVersion+"/main.js", nil))
	if before.Code != http.StatusOK {
		t.Fatalf("initial asset status = %d, want 200", before.Code)
	}

	if err := os.WriteFile(versionFile, []byte("1.0.7\n"), 0o600); err != nil {
		t.Fatalf("update .lpk-version error = %v", err)
	}
	oldVersion := httptest.NewRecorder()
	handler.ServeHTTP(oldVersion, httptest.NewRequest(http.MethodGet, "/assets/"+initialAssetVersion+"/main.js", nil))
	if oldVersion.Code != http.StatusNotFound {
		t.Fatalf("old asset status after LPK update = %d, want 404", oldVersion.Code)
	}
	newVersion := httptest.NewRecorder()
	updatedAssetVersion := "1.0.7-" + strings.Repeat("a", assetRevisionLength)
	handler.ServeHTTP(newVersion, httptest.NewRequest(http.MethodGet, "/assets/"+updatedAssetVersion+"/main.js", nil))
	if newVersion.Code != http.StatusOK {
		t.Fatalf("new asset status after LPK update = %d, want 200", newVersion.Code)
	}
}

func TestVersionedStaticFileServerTracksSameVersionContentWithoutRestart(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.js"), []byte("console.log('versioned');"), 0o600); err != nil {
		t.Fatalf("WriteFile(main.js) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, ".lpk-version"), []byte("1.0.6\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(.lpk-version) error = %v", err)
	}
	revisionFile := filepath.Join(root, contentRevisionFileName)
	if err := os.WriteFile(revisionFile, []byte(strings.Repeat("a", 64)+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", contentRevisionFileName, err)
	}
	server := &pluginServer{rootDir: root, assetVersion: "1.0.6-" + strings.Repeat("a", assetRevisionLength)}
	handler := versionedStaticFileServer(root, server.currentAssetVersion)
	oldAssetVersion := server.currentAssetVersion()

	if err := os.WriteFile(revisionFile, []byte(strings.Repeat("b", 64)+"\n"), 0o600); err != nil {
		t.Fatalf("update %s error = %v", contentRevisionFileName, err)
	}
	newAssetVersion := server.currentAssetVersion()
	if oldAssetVersion == newAssetVersion {
		t.Fatalf("asset version remained %q after content revision changed", oldAssetVersion)
	}

	oldResponse := httptest.NewRecorder()
	handler.ServeHTTP(oldResponse, httptest.NewRequest(http.MethodGet, "/assets/"+oldAssetVersion+"/main.js", nil))
	if oldResponse.Code != http.StatusNotFound {
		t.Fatalf("old same-version asset status = %d, want 404", oldResponse.Code)
	}
	newResponse := httptest.NewRecorder()
	handler.ServeHTTP(newResponse, httptest.NewRequest(http.MethodGet, "/assets/"+newAssetVersion+"/main.js", nil))
	if newResponse.Code != http.StatusOK {
		t.Fatalf("new same-version asset status = %d, want 200", newResponse.Code)
	}
}

func TestHandleIndexInjectsLPKVersionedAssetBase(t *testing.T) {
	root := t.TempDir()
	staticDir := filepath.Join(root, "runtime", "static")
	if err := os.MkdirAll(staticDir, 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	index := `<link rel="stylesheet" href="__LCMD_ASSET_BASE__style.css"><script src="__LCMD_ASSET_BASE__main.js"></script>`
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte(index), 0o600); err != nil {
		t.Fatalf("WriteFile(index.html) error = %v", err)
	}
	server := &pluginServer{rootDir: root, assetVersion: "2.0.0+7-abcdef0123456789abcdef01"}
	recorder := httptest.NewRecorder()

	server.handleIndex(recorder, httptest.NewRequest(http.MethodGet, "/", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, `./assets/2.0.0+7-abcdef0123456789abcdef01/main.js`) || strings.Contains(body, assetBasePlaceholder) {
		t.Fatalf("versioned index was not injected correctly: %s", body)
	}
}

func TestServiceWorkerIsServedAtRootScope(t *testing.T) {
	root := t.TempDir()
	staticDir := filepath.Join(root, "runtime", "static")
	if err := os.MkdirAll(staticDir, 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	workerSource := `const version = "__LCMD_ASSET_VERSION__"; const base = "__LCMD_ASSET_BASE__";`
	if err := os.WriteFile(filepath.Join(staticDir, "service-worker.js"), []byte(workerSource), 0o600); err != nil {
		t.Fatalf("WriteFile(service-worker.js) error = %v", err)
	}
	server := &pluginServer{rootDir: root, assetVersion: "3.4.5-abcdef0123456789abcdef01"}
	recorder := httptest.NewRecorder()
	server.handleServiceWorker(recorder, httptest.NewRequest(http.MethodGet, "/service-worker.js", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("Service-Worker-Allowed"); got != "/" {
		t.Fatalf("Service-Worker-Allowed = %q, want /", got)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("Cache-Control = %q, want no-cache", got)
	}
	if body := recorder.Body.String(); !strings.Contains(body, `"3.4.5-abcdef0123456789abcdef01"`) || !strings.Contains(body, `"/assets/3.4.5-abcdef0123456789abcdef01/"`) {
		t.Fatalf("service worker version injection failed: %s", body)
	}
}

func TestDynamicAssetResponsesTrackLPKVersionWithoutRestart(t *testing.T) {
	root := t.TempDir()
	staticDir := filepath.Join(root, "runtime", "static")
	if err := os.MkdirAll(staticDir, 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	index := `<script src="__LCMD_ASSET_BASE__main.js"></script>`
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte(index), 0o600); err != nil {
		t.Fatalf("WriteFile(index.html) error = %v", err)
	}
	workerSource := `const version = "__LCMD_ASSET_VERSION__"; const base = "__LCMD_ASSET_BASE__";`
	if err := os.WriteFile(filepath.Join(staticDir, "service-worker.js"), []byte(workerSource), 0o600); err != nil {
		t.Fatalf("WriteFile(service-worker.js) error = %v", err)
	}
	versionFile := filepath.Join(root, ".lpk-version")
	revisionFile := filepath.Join(root, contentRevisionFileName)
	if err := os.WriteFile(versionFile, []byte("1.0.6\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(.lpk-version) error = %v", err)
	}
	if err := os.WriteFile(revisionFile, []byte(strings.Repeat("a", 64)+"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(%s) error = %v", contentRevisionFileName, err)
	}
	initialAssetVersion := "1.0.6-" + strings.Repeat("a", assetRevisionLength)
	server := &pluginServer{rootDir: root, assetVersion: initialAssetVersion, serverRevision: "process-one"}
	if revision := server.currentServerRevision(); revision != "process-one:assets="+initialAssetVersion {
		t.Fatalf("initial server revision = %q, want process-one:assets=%s", revision, initialAssetVersion)
	}

	if err := os.WriteFile(versionFile, []byte("1.0.7\n"), 0o600); err != nil {
		t.Fatalf("update .lpk-version error = %v", err)
	}
	indexRecorder := httptest.NewRecorder()
	server.handleIndex(indexRecorder, httptest.NewRequest(http.MethodGet, "/", nil))
	updatedAssetVersion := "1.0.7-" + strings.Repeat("a", assetRevisionLength)
	if body := indexRecorder.Body.String(); !strings.Contains(body, `./assets/`+updatedAssetVersion+`/main.js`) {
		t.Fatalf("index did not use updated LPK version: %s", body)
	}

	workerRecorder := httptest.NewRecorder()
	server.handleServiceWorker(workerRecorder, httptest.NewRequest(http.MethodGet, "/service-worker.js", nil))
	if body := workerRecorder.Body.String(); !strings.Contains(body, `"`+updatedAssetVersion+`"`) || !strings.Contains(body, `"/assets/`+updatedAssetVersion+`/"`) {
		t.Fatalf("service worker did not use updated LPK version: %s", body)
	}

	revisionRecorder := httptest.NewRecorder()
	server.handleServerRevision(revisionRecorder, httptest.NewRequest(http.MethodGet, "/api/server-revision", nil))
	var info serverRevisionInfo
	if err := json.Unmarshal(revisionRecorder.Body.Bytes(), &info); err != nil {
		t.Fatalf("unmarshal server revision response: %v", err)
	}
	if info.ServerRevision != "process-one:assets="+updatedAssetVersion {
		t.Fatalf("server revision = %q, want process-one:assets=%s", info.ServerRevision, updatedAssetVersion)
	}
}

func TestCurrentRequestAccountIDRequiresHeaderByDefault(t *testing.T) {
	t.Setenv(lightOSRequireCookieAuthEnv, "")
	t.Setenv(lazyCatAppDeployUIDEnv, "deploy-user")

	req := httptest.NewRequest(http.MethodGet, "/api/instances", nil)

	if got := currentRequestAccountID(req); got != "" {
		t.Fatalf("currentRequestAccountID() = %q, want empty", got)
	}
}

func TestCurrentRequestAccountIDUsesDeployUIDWhenCookieAuthDisabled(t *testing.T) {
	t.Setenv(lightOSRequireCookieAuthEnv, "false")
	t.Setenv(lazyCatAppDeployUIDEnv, "deploy-user")

	req := httptest.NewRequest(http.MethodGet, "/api/instances", nil)

	if got := currentRequestAccountID(req); got != "deploy-user" {
		t.Fatalf("currentRequestAccountID() = %q, want deploy-user", got)
	}
}

func TestCurrentRequestAccountIDKeepsHeaderWhenCookieAuthDisabled(t *testing.T) {
	t.Setenv(lightOSRequireCookieAuthEnv, "false")
	t.Setenv(lazyCatAppDeployUIDEnv, "deploy-user")

	req := httptest.NewRequest(http.MethodGet, "/api/instances", nil)
	req.Header.Set(lightOSUserIDHeader, "header-user")

	if got := currentRequestAccountID(req); got != "header-user" {
		t.Fatalf("currentRequestAccountID() = %q, want header-user", got)
	}
}

func TestCurrentDeployUIDFromEnvUsesLegacyUserID(t *testing.T) {
	t.Setenv(lazyCatAppDeployUIDEnv, "")
	t.Setenv(lazyCatDeployUIDEnv, "")
	t.Setenv(lazyCatUserIDEnv, "legacy-user")

	if got := currentDeployUIDFromEnv(); got != "legacy-user" {
		t.Fatalf("currentDeployUIDFromEnv() = %q, want legacy-user", got)
	}
}

func TestCurrentDeployUIDFromEnvUsesAppID(t *testing.T) {
	t.Setenv(lazyCatAppDeployUIDEnv, "")
	t.Setenv(lazyCatDeployUIDEnv, "")
	t.Setenv(lazyCatUserIDEnv, "")
	t.Setenv(lazyCatUserUIDEnv, "")
	t.Setenv(lazyCatAppDeployIDEnv, "")
	t.Setenv(lazyCatDeployIDEnv, "")
	t.Setenv(lazyCatAppIDEnv, "cloud.lazycat.lightos.entry")

	if got := currentDeployUIDFromEnv(); got != "cloud.lazycat.lightos.entry" {
		t.Fatalf("currentDeployUIDFromEnv() = %q, want cloud.lazycat.lightos.entry", got)
	}
}

func TestLightOSConfigFileValueSupportsQuotedEnv(t *testing.T) {
	filename := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(filename, []byte("LIGHTOS_REQUIRE_COOKIE_AUTH=\"false\"\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(.env) error = %v", err)
	}

	value, ok := readLightOSConfigFileValue(filename, lightOSRequireCookieAuthEnv)
	if !ok || value != "false" {
		t.Fatalf("readLightOSConfigFileValue() = %q, %v; want false, true", value, ok)
	}
}

func TestHandleLightOSAdminInfoReturnsStandaloneHomeURL(t *testing.T) {
	t.Setenv(lazyCatAppIDEnv, "cloud.lazycat.webshell.lcmd")
	server := &pluginServer{
		adminInfoResolver: func(context.Context) (adminInfo, error) {
			return adminInfo{
				DeployID: "admin-deploy",
				Domain:   "admin.example",
				BaseURL:  "https://admin.example/lightos/?source=provider#section",
			}, nil
		},
	}
	recorder := httptest.NewRecorder()

	server.handleLightOSAdminInfo(recorder, httptest.NewRequest(http.MethodGet, "/api/lightos-admin-info", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var response adminInfo
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode response error = %v", err)
	}
	if got, want := response.HomeURL, "https://admin.example/lightos/?source=provider&view=home"; got != want {
		t.Fatalf("home_url = %q, want %q", got, want)
	}
}

func TestHandleLightOSAdminInfoReturnsRelativeBuiltinHomeURL(t *testing.T) {
	t.Setenv(lazyCatAppIDEnv, lightOSAdminAppID)
	server := &pluginServer{
		adminInfoResolver: func(context.Context) (adminInfo, error) {
			return adminInfo{BaseURL: "https://internal-admin.example/lightos/"}, nil
		},
	}
	recorder := httptest.NewRecorder()

	server.handleLightOSAdminInfo(recorder, httptest.NewRequest(http.MethodGet, "/api/lightos-admin-info", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	var response adminInfo
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode response error = %v", err)
	}
	if got, want := response.HomeURL, "/?view=home"; got != want {
		t.Fatalf("home_url = %q, want %q", got, want)
	}
}
