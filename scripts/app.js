$(document).ready(function() {
    window.db = new Dexie('MyNotes');
    db.version(1).stores({
        notes: 'id, notes'
    });
    db.version(2).stores({
        notes: 'id, notes',
        settings: 'key'
    });

    const notesCache = new Map();
    let allRepos = [];
    let currentRepoId = null;
    let currentRepoName = '';

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function showToast(text, type) {
        const $toast = $("#toast");

        clearTimeout($toast.data("timer"));
        $toast
            .text(text)
            .attr("data-status", type || "idle")
            .addClass("is-visible");

        $toast.data("timer", setTimeout(function() {
            $toast.removeClass("is-visible");
        }, 2600));
    }

    function openModal(id) {
        $("#" + id).addClass("is-open").attr("aria-hidden", "false");
    }

    function closeModal(id) {
        $("#" + id).removeClass("is-open").attr("aria-hidden", "true");
    }

    function normalizeNotesPayload(data) {
        const notes = Array.isArray(data) ? data : data && Array.isArray(data.notes) ? data.notes : [];

        return notes.reduce(function(map, item) {
            if (item && item.id !== undefined) {
                map.set(item.id.toString(), item.notes || '');
            }

            return map;
        }, new Map());
    }

    function replaceNotes(nextNotes) {
        notesCache.clear();
        nextNotes.forEach(function(note, id) {
            notesCache.set(id, note);
        });
    }

    async function fetchNotesFromFile() {
        const response = await fetch('data/notes.json?t_=' + Date.now(), {
            headers: {'Cache-Control': 'no-cache'}
        });

        if (!response.ok) {
            return new Map();
        }

        const text = await response.text();

        if (!text.trim()) {
            return new Map();
        }

        return normalizeNotesPayload(JSON.parse(text));
    }

    function noteText(id) {
        return notesCache.get(id.toString()) || '';
    }

    function updateCardNote(id) {
        const note = noteText(id);
        const $card = $(`.repo[data-id="${id}"]`);
        const $note = $card.find(".note-preview");

        if (note.trim()) {
            $note.text(note).removeClass("is-empty");
        } else {
            $note.text("暂无备注").addClass("is-empty");
        }
    }

    function buildNotesPayload() {
        return {
            notes: Array.from(notesCache.entries())
                .filter(function(entry) {
                    return entry[1].trim() !== '';
                })
                .map(function(entry) {
                    return {
                        id: entry[0],
                        notes: entry[1]
                    };
                })
        };
    }

    function encodeBase64(value) {
        const bytes = new TextEncoder().encode(value);
        let binary = '';

        bytes.forEach(function(byte) {
            binary += String.fromCharCode(byte);
        });

        return btoa(binary);
    }

    function decodeBase64(value) {
        return decodeURIComponent(escape(atob((value || '').replace(/\n/g, ''))));
    }

    function defaultConfig() {
        return {
            key: 'github',
            token: '',
            owner: '',
            repo: '',
            branch: 'main'
        };
    }

    async function getConfig() {
        return Object.assign(defaultConfig(), await db.settings.get('github'));
    }

    async function saveConfig() {
        const config = {
            key: 'github',
            token: $("#githubToken").val().trim(),
            owner: $("#repoOwner").val().trim(),
            repo: $("#repoName").val().trim(),
            branch: $("#repoBranch").val().trim() || 'main'
        };

        await db.settings.put(config);
        showToast("远端提交配置已保存", "saved");
        closeModal("configModal");
    }

    async function loadConfigToForm() {
        const config = await getConfig();

        $("#githubToken").val(config.token);
        $("#repoOwner").val(config.owner);
        $("#repoName").val(config.repo);
        $("#repoBranch").val(config.branch);
    }

    function githubHeaders(config) {
        return {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${config.token}`,
            'X-GitHub-Api-Version': '2022-11-28'
        };
    }

    async function requireGitHubConfig() {
        const config = await getConfig();

        if (!config.token || !config.owner || !config.repo || !config.branch) {
            await loadConfigToForm();
            openModal("configModal");
            throw new Error("缺少 GitHub 提交配置");
        }

        return config;
    }

    async function fetchNotesFromGitHub(config) {
        const filePath = 'data/notes.json';
        const apiUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}`;
        const response = await fetch(`${apiUrl}?ref=${encodeURIComponent(config.branch)}`, {
            headers: githubHeaders(config)
        });

        if (response.status === 404) {
            return {
                sha: null,
                notes: new Map()
            };
        }

        if (!response.ok) {
            throw new Error(`读取远端 notes.json 失败：${response.status}`);
        }

        const file = await response.json();
        const text = decodeBase64(file.content);

        return {
            sha: file.sha,
            notes: text.trim() ? normalizeNotesPayload(JSON.parse(text)) : new Map()
        };
    }

    async function commitNotesToGitHub() {
        const config = await requireGitHubConfig();
        const filePath = 'data/notes.json';
        const apiUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}`;
        const remote = await fetchNotesFromGitHub(config);
        const content = JSON.stringify(buildNotesPayload(), null, 2);
        const body = {
            message: 'Update notes',
            content: encodeBase64(content),
            branch: config.branch
        };

        if (remote.sha) {
            body.sha = remote.sha;
        }

        const response = await fetch(apiUrl, {
            method: 'PUT',
            headers: Object.assign({}, githubHeaders(config), {
                'Content-Type': 'application/json'
            }),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`提交远端失败：${response.status}`);
        }

        replaceNotes(normalizeNotesPayload(JSON.parse(content)));
        applySearch();
    }

    function renderRepos(repos) {
        const html = repos.map(function(repo) {
            const id = repo.id.toString();
            const note = noteText(id);
            const noteClass = note.trim() ? '' : ' is-empty';

            return `
                <article class="repo" data-id="${id}" data-name="${escapeHtml(repo.full_name)}">
                    <button class="edit-note-btn" type="button" data-id="${id}">修改备注</button>
                    <div class="repo-main">
                        <h3><a href="${escapeHtml(repo.html_url)}" target="_blank">${escapeHtml(repo.full_name)}</a></h3>
                        <p class="repo-description">${escapeHtml(repo.description || 'No description')}</p>
                        <div class="repo-meta">
                            <span>Stars: ${escapeHtml(repo.stargazers_count)}</span>
                            <span>${escapeHtml(repo.language || 'Unknown')}</span>
                        </div>
                        <p class="note-preview${noteClass}">${escapeHtml(note || '暂无备注')}</p>
                    </div>
                </article>
            `;
        }).join('');

        $("#repos").html(html);
        $("#saveAllBtn").prop("disabled", false);
        $("#syncRemoteBtn").prop("disabled", false);
    }

    function normalizeSearchText(value) {
        return String(value || '').trim().toLowerCase();
    }

    function applySearch() {
        const keyword = normalizeSearchText($("#searchInput").val());

        if (!keyword) {
            renderRepos(allRepos);
            return;
        }

        renderRepos(allRepos.filter(function(repo) {
            const name = normalizeSearchText(repo.full_name);
            const description = normalizeSearchText(repo.description);

            return name.includes(keyword) || description.includes(keyword);
        }));
    }

    Promise.all([
        fetch('data/starred_repos.json?t_=' + Date.now(), {headers: {'Cache-Control': 'no-cache'}}).then(response => response.json()),
        fetchNotesFromFile()
    ])
        .then(function(results) {
            allRepos = results[0];
            replaceNotes(results[1]);
            applySearch();
        })
        .catch(function(error) {
            console.error('Error loading repos:', error);
            showToast("加载 Star 列表失败", "error");
        });

    $("#repos").on("click", ".edit-note-btn", function() {
        currentRepoId = $(this).data("id").toString();
        currentRepoName = $(this).closest(".repo").data("name");

        $("#noteRepoName").text(currentRepoName);
        $("#noteEditor").val(noteText(currentRepoId));
        openModal("noteModal");
        $("#noteEditor").trigger("focus");
    });

    $("#saveRemoteBtn").click(async function() {
        if (!currentRepoId) return;

        const $button = $(this);

        try {
            $button.prop("disabled", true).text("提交中");
            notesCache.set(currentRepoId, $("#noteEditor").val() || '');
            updateCardNote(currentRepoId);
            await commitNotesToGitHub();
            showToast("备注已提交到远端", "saved");
            closeModal("noteModal");
        } catch (error) {
            if (error.message !== "缺少 GitHub 提交配置") {
                console.error('远端提交失败:', error);
            }
            showToast(error.message || "远端提交失败", "error");
        } finally {
            $button.prop("disabled", false).text("保存到远端");
        }
    });

    $("#saveAllBtn").click(async function() {
        const $button = $(this);

        try {
            $button.prop("disabled", true).text("提交中");
            await commitNotesToGitHub();
            showToast("全部备注已提交到远端", "saved");
        } catch (error) {
            if (error.message !== "缺少 GitHub 提交配置") {
                console.error('远端保存失败:', error);
            }
            showToast(error.message || "远端保存失败", "error");
        } finally {
            $button.prop("disabled", false).text("保存至远端");
        }
    });

    $("#syncRemoteBtn").click(async function() {
        const $button = $(this);

        try {
            $button.prop("disabled", true).text("同步中");
            const config = await requireGitHubConfig();
            const remote = await fetchNotesFromGitHub(config);

            replaceNotes(remote.notes);
            applySearch();
            showToast("远端备注已同步", "saved");
        } catch (error) {
            if (error.message !== "缺少 GitHub 提交配置") {
                console.error('同步失败:', error);
            }
            showToast(error.message || "同步失败", "error");
        } finally {
            $button.prop("disabled", false).text("同步远端");
        }
    });

    $("#configBtn").click(async function() {
        await loadConfigToForm();
        openModal("configModal");
    });

    $("#searchForm").submit(function(event) {
        event.preventDefault();
        applySearch();
    });

    $("#searchInput").on("input", function() {
        applySearch();
    });

    $("#saveConfigBtn").click(function() {
        saveConfig().catch(function(error) {
            console.error('配置保存失败:', error);
            showToast("配置保存失败", "error");
        });
    });

    $("[data-close-modal]").click(function() {
        closeModal($(this).data("close-modal"));
    });

    $(".modal-backdrop").click(function(event) {
        if (event.target === this) {
            closeModal($(this).attr("id"));
        }
    });
});
