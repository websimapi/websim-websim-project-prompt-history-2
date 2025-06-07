const urlInput = document.getElementById('project-url');
const fetchButton = document.getElementById('fetch-button');
const historyContainer = document.getElementById('history-container');
const loader = document.getElementById('loader');
const errorContainer = document.getElementById('error-container');

const BOOKMARK_COLORS = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db'];
const LOCAL_STORAGE_KEY = 'websimPromptBookmarks';

function getBookmarks() {
    try {
        const data = localStorage.getItem(LOCAL_STORAGE_KEY);
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.error("Failed to parse bookmarks from localStorage", e);
        return {};
    }
}

function saveBookmarks(bookmarks) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
}

function handleBookmarkClick(event) {
    const button = event.currentTarget;
    const { projectId, revisionVersion, color } = button.dataset;

    const bookmarks = getBookmarks();
    if (!bookmarks[projectId]) {
        bookmarks[projectId] = {};
    }

    const currentBookmark = bookmarks[projectId][revisionVersion];

    if (currentBookmark === color) {
        // Clicked the same color again, so un-bookmark
        delete bookmarks[projectId][revisionVersion];
    } else {
        // Set new bookmark color
        bookmarks[projectId][revisionVersion] = color;
    }

    saveBookmarks(bookmarks);

    // Update UI for this revision item
    const revisionItem = button.closest('.revision-item');
    const bookmarkButtons = revisionItem.querySelectorAll('.bookmark-button');
    const newBookmark = bookmarks[projectId]?.[revisionVersion];
    
    bookmarkButtons.forEach(btn => {
        if (btn.dataset.color === newBookmark) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

fetchButton.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
        showError('Please enter a project URL, ID, or slug.');
        return;
    }

    clearUI();
    loader.style.display = 'block';

    try {
        const projectId = await resolveProjectId(url);
        if (!projectId) {
            showError('Invalid input. Please use a project ID, a project URL (e.g., /p/...), or a user slug (e.g., @username/project-slug).');
            loader.style.display = 'none';
            return;
        }

        const project = await getProject(projectId);
        const history = await fetchAllRevisions(projectId);

        let parentHistory = null;
        let parentProject = null;
        if (project && project.parent_id) {
            parentProject = await getProject(project.parent_id);
            parentHistory = await fetchAllRevisions(project.parent_id);
        }

        renderHistory(history, parentHistory, parentProject, project);

    } catch (err) {
        showError(err.message);
    } finally {
        loader.style.display = 'none';
    }
});

urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        fetchButton.click();
    }
});


async function resolveProjectId(input) {
    input = input.trim();

    // 1. Project ID
    if (input.length === 20 && /^[a-z0-9_-]+$/.test(input)) {
        return input;
    }

    // 2. Project URL: /p/PROJECT_ID
    let match = input.match(/\/p\/([a-z0-9_-]{20})/);
    if (match) {
        return match[1];
    }

    // 3. Slug URL: /@username/slug or @username/slug
    match = input.match(/@([a-zA-Z0-9_]{3,32})\/([a-zA-Z0-9-]{3,50})/);
    if (match) {
        const username = match[1];
        const slug = match[2];
        const apiUrl = `/api/v1/users/${username}/slugs/${slug}`;
        const response = await fetch(apiUrl);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(`Project not found for user @${username} with slug "${slug}".`);
            }
            throw new Error(`Failed to fetch project by slug. Status: ${response.status}`);
        }
        const data = await response.json();
        if (data && data.project && data.project.id) {
            return data.project.id;
        } else {
            throw new Error('Could not get project ID from slug response.');
        }
    }

    return null;
}

async function getProject(projectId) {
    const response = await fetch(`/api/v1/projects/${projectId}`);
    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Project with ID ${projectId} not found.`);
        }
        throw new Error(`Failed to fetch project data. Status: ${response.status}`);
    }
    const data = await response.json();
    return data.project;
}

async function fetchAllRevisions(projectId) {
    let allRevisions = [];
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
        const apiUrl = `/api/v1/projects/${projectId}/revisions?first=100${cursor ? `&after=${cursor}` : ''}`;
        const response = await fetch(apiUrl);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Project not found. Please check the URL or ID.');
            }
            throw new Error(`Failed to fetch revisions. Status: ${response.status}`);
        }

        const data = await response.json();
        const revisionsData = data.revisions.data;

        if (!revisionsData || revisionsData.length === 0) {
            break;
        }

        allRevisions.push(...revisionsData);
        hasNextPage = data.revisions.meta.has_next_page;
        cursor = data.revisions.meta.end_cursor;
    }

    return allRevisions;
}

function renderRevisionList(revisions, container, projectId) {
    const bookmarks = getBookmarks();
    const projectBookmarks = bookmarks[projectId] || {};
    const validRevisions = revisions.filter(item => item.site && item.site.prompt && item.site.prompt.text);

    if (validRevisions.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'No prompt history found for this project.';
        container.appendChild(p);
        return;
    }

    validRevisions.sort((a, b) => a.project_revision.version - b.project_revision.version);

    const fragment = document.createDocumentFragment();
    validRevisions.forEach(item => {
        const { project_revision, site } = item;
        const prompt = site.prompt;
        const revisionVersion = project_revision.version;

        const revisionElement = document.createElement('div');
        revisionElement.className = 'revision-item';

        const header = document.createElement('div');
        header.className = 'revision-header';
        header.innerHTML = `<strong>Version ${revisionVersion}</strong> <span class="prompt-type">(${prompt.type})</span>`;

        const promptText = document.createElement('p');
        promptText.className = 'prompt-text';
        promptText.textContent = prompt.text;

        const bookmarkContainer = document.createElement('div');
        bookmarkContainer.className = 'bookmark-container';

        BOOKMARK_COLORS.forEach(color => {
            const button = document.createElement('button');
            button.className = 'bookmark-button';
            button.style.backgroundColor = color;
            button.dataset.projectId = projectId;
            button.dataset.revisionVersion = revisionVersion;
            button.dataset.color = color;
            button.setAttribute('aria-label', `Bookmark with color ${color}`);

            if (projectBookmarks[revisionVersion] === color) {
                button.classList.add('active');
            }

            button.addEventListener('click', handleBookmarkClick);
            bookmarkContainer.appendChild(button);
        });

        revisionElement.appendChild(header);
        revisionElement.appendChild(promptText);
        revisionElement.appendChild(bookmarkContainer);

        fragment.appendChild(revisionElement);
    });

    container.appendChild(fragment);
}

function renderHistory(revisions, parentRevisions, parentProject, project) {
    historyContainer.innerHTML = '';

    const hasHistory = revisions.some(item => item.site && item.site.prompt && item.site.prompt.text);
    const hasParentHistory = parentRevisions && parentRevisions.some(item => item.site && item.site.prompt && item.site.prompt.text);

    if (!hasHistory && !hasParentHistory) {
        historyContainer.innerHTML = '<p>No prompt history found for this project or its parent.</p>';
        return;
    }

    if (parentRevisions && parentProject) {
        const parentHeader = document.createElement('h2');
        const parentLink = document.createElement('a');
        parentLink.href = `/p/${parentProject.id}`;
        parentLink.target = '_blank';
        parentLink.textContent = parentProject.title || `Project ${parentProject.id}`;

        parentHeader.textContent = `Parent Project History: `;
        parentHeader.appendChild(parentLink);
        historyContainer.appendChild(parentHeader);

        renderRevisionList(parentRevisions, historyContainer, parentProject.id);
    }

    const projectHeader = document.createElement('h2');
    let projectTitleText = `History for ${project.title || `Project ${project.id}`}`;
    if (project.parent_id) {
        projectTitleText += ' (Fork)';
    }
    projectHeader.textContent = projectTitleText;
    historyContainer.appendChild(projectHeader);

    renderRevisionList(revisions, historyContainer, project.id);
}

function showError(message) {
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';
}

function clearUI() {
    historyContainer.innerHTML = '';
    errorContainer.textContent = '';
    errorContainer.style.display = 'none';
}