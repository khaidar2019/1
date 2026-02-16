import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function Dashboard() {
  const { logout } = useAuth();
  const [projects, setProjects] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [status, setStatus] = useState(null);
  const [projectName, setProjectName] = useState('');

  const [accountForm, setAccountForm] = useState({ channel: 'whatsapp', label: '', sessionPath: '/sessions/account-1' });
  const [campaignForm, setCampaignForm] = useState({ projectId: '', accountId: '', channel: 'whatsapp', name: '', template: '' });

  async function loadBase() {
    const [p, a] = await Promise.all([api.get('/projects'), api.get('/accounts')]);
    setProjects(p.data.projects);
    setAccounts(a.data.accounts);
  }

  useEffect(() => {
    loadBase().catch(console.error);
  }, []);

  const createProject = async () => {
    await api.post('/projects', { name: projectName });
    setProjectName('');
    await loadBase();
  };

  const createAccount = async () => {
    await api.post('/accounts', accountForm);
    await loadBase();
  };

  const uploadContacts = async (projectId, file) => {
    const formData = new FormData();
    formData.append('projectId', projectId);
    formData.append('file', file);
    await api.post('/contacts/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    alert('Contacts uploaded');
  };

  const startCampaign = async () => {
    const { data } = await api.post('/campaign/start', campaignForm);
    setSelectedCampaign(data.campaignId);
    alert('Campaign queued');
  };

  const fetchStatus = async () => {
    const { data } = await api.get(`/campaign/status/${selectedCampaign}`);
    setStatus(data);
  };

  return (
    <div style={{ padding: 20, fontFamily: 'Arial, sans-serif', display: 'grid', gap: 16 }}>
      <h1>Bulk Messaging Dashboard</h1>
      <button onClick={logout}>Logout</button>

      <section>
        <h3>Create Project</h3>
        <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name" />
        <button onClick={createProject}>Create</button>
      </section>

      <section>
        <h3>Create Messaging Account</h3>
        <select value={accountForm.channel} onChange={(e) => setAccountForm({ ...accountForm, channel: e.target.value })}>
          <option value="whatsapp">WhatsApp</option>
          <option value="telegram">Telegram</option>
        </select>
        <input placeholder="Label" value={accountForm.label} onChange={(e) => setAccountForm({ ...accountForm, label: e.target.value })} />
        <input
          placeholder="Session path"
          value={accountForm.sessionPath}
          onChange={(e) => setAccountForm({ ...accountForm, sessionPath: e.target.value })}
        />
        <button onClick={createAccount}>Save account</button>
      </section>

      <section>
        <h3>Projects</h3>
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              {project.name}
              <input type="file" accept=".csv,.xlsx" onChange={(e) => uploadContacts(project.id, e.target.files[0])} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Start Campaign</h3>
        <select value={campaignForm.projectId} onChange={(e) => setCampaignForm({ ...campaignForm, projectId: e.target.value })}>
          <option value="">Select project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <select value={campaignForm.accountId} onChange={(e) => setCampaignForm({ ...campaignForm, accountId: e.target.value })}>
          <option value="">Select account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label} ({account.channel})
            </option>
          ))}
        </select>
        <input placeholder="Campaign name" value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} />
        <textarea
          placeholder="Template e.g. {Hi|Hello} {name}, your order is ready"
          value={campaignForm.template}
          onChange={(e) => setCampaignForm({ ...campaignForm, template: e.target.value })}
        />
        <button onClick={startCampaign}>Start Campaign</button>
      </section>

      <section>
        <h3>Campaign Status</h3>
        <input value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)} placeholder="Campaign ID" />
        <button onClick={fetchStatus}>Refresh Status</button>
        {status && (
          <div>
            <pre>{JSON.stringify(status.stats, null, 2)}</pre>
            <pre>{JSON.stringify(status.logs.slice(0, 5), null, 2)}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
