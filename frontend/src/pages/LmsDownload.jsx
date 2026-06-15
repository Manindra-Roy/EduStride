import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { 
  FileDown, 
  Upload, 
  Trash2, 
  BookOpen, 
  Sliders, 
  Check, 
  X, 
  FileText,
  Filter
} from 'lucide-react';

const LmsDownload = () => {
  const { user } = useAuth();
  
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [selectedClass, setSelectedClass] = useState(user.role === 'Student' ? user.studentProfile?.class_level : 'All');
  const [selectedSubject, setSelectedSubject] = useState('All');

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Form states
  const [uploadForm, setUploadForm] = useState({
    class_level: '',
    subject: '',
    chapter_name: '',
    status: 'Drafting'
  });
  const [selectedFile, setSelectedFile] = useState(null);

  const [classes, setClasses] = useState([]);
  const [filterSubjects, setFilterSubjects] = useState([]);
  const [uploadSubjects, setUploadSubjects] = useState([]);

  // Fetch filter subjects based on active selection
  useEffect(() => {
    const fetchFilterSubjects = async () => {
      try {
        const url = selectedClass === 'All' ? '/api/subjects' : `/api/subjects?class_level=${selectedClass}`;
        const res = await axios.get(url);
        if (res.data.success && Array.isArray(res.data.data)) {
          const subjectNames = [...new Set(res.data.data.map(s => s.name))];
          setFilterSubjects(subjectNames);
        }
      } catch (err) {
        console.error('Failed to load filter subjects:', err);
      }
    };
    fetchFilterSubjects();
  }, [selectedClass]);

  // Fetch upload subjects based on the form class level target
  useEffect(() => {
    const fetchUploadSubjects = async () => {
      try {
        const res = await axios.get(`/api/subjects?class_level=${uploadForm.class_level}`);
        if (res.data.success && Array.isArray(res.data.data)) {
          const subjectNames = res.data.data.map(s => s.name);
          setUploadSubjects(subjectNames);
          if (subjectNames.length > 0 && !subjectNames.includes(uploadForm.subject)) {
            setUploadForm(prev => ({ ...prev, subject: subjectNames[0] }));
          }
        }
      } catch (err) {
        console.error('Failed to load upload subjects:', err);
      }
    };
    if (showUploadModal) {
      fetchUploadSubjects();
    }
  }, [uploadForm.class_level, showUploadModal]);

  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const res = await axios.get('/api/classes');
        if (res.data.success) {
          setClasses(res.data.data);
          if (res.data.data.length > 0) {
            setUploadForm(prev => ({ ...prev, class_level: res.data.data[0] }));
          }
        }
      } catch (err) {
        console.error('Failed to load classes:', err);
      }
    };
    fetchClasses();
  }, []);

  const pipelineStates = ['Drafting', 'Notes Distributed', 'Assignment Assigned', 'Revised'];

  // Fetch handouts
  const fetchMaterials = async () => {
    setLoading(true);
    try {
      let url = '/api/study-materials?';
      if (user.role !== 'Student' && selectedClass !== 'All') {
        url += `class_level=${selectedClass}&`;
      }
      if (selectedSubject !== 'All') {
        url += `subject=${selectedSubject}&`;
      }
      const res = await axios.get(url);
      if (res.data.success) {
        setMaterials(res.data.data);
      }
    } catch (err) {
      console.error('Failed to load study materials:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMaterials();
  }, [selectedClass, selectedSubject]);

  // File selection
  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  // Submit Multer upload
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('class_level', uploadForm.class_level);
    formData.append('subject', uploadForm.subject);
    formData.append('chapter_name', uploadForm.chapter_name);
    formData.append('status', uploadForm.status);

    try {
      const res = await axios.post('/api/study-materials/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      if (res.data.success) {
        setShowUploadModal(false);
        setUploadForm({
          class_level: classes[0] || '',
          subject: uploadSubjects[0] || '',
          chapter_name: '',
          status: 'Drafting'
        });
        setSelectedFile(null);
        fetchMaterials();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // Delete handout
  const handleDeleteMaterial = async (id) => {
    if (window.confirm('Delete this handout permanently?')) {
      try {
        const res = await axios.delete(`/api/study-materials/${id}`);
        if (res.data.success) {
          fetchMaterials();
        }
      } catch (err) {
        alert('Failed to delete handout');
      }
    }
  };

  // Update syllabus progress / tracking state
  const handleStatusChange = async (id, newStatus) => {
    try {
      const res = await axios.put(`/api/study-materials/${id}`, { status: newStatus });
      if (res.data.success) {
        fetchMaterials();
      }
    } catch (err) {
      alert('Failed to update curricular status');
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'Drafting': return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
      case 'Notes Distributed': return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
      case 'Assignment Assigned': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'Revised': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      default: return 'bg-slate-500/10 text-slate-400';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Add Button */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white font-outfit">LMS Download & Notes Library</h1>
          <p className="text-slate-400 text-sm mt-1">Access notes handouts, assignments, and curriculum updates</p>
        </div>

        {user.role !== 'Student' && (
          <button
            onClick={() => {
              setError('');
              setShowUploadModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-medium text-xs transition duration-150 shadow-lg shadow-primary-500/10 self-start"
          >
            <Upload size={16} />
            <span>Publish Handouts</span>
          </button>
        )}
      </div>

      {/* Filters Strip */}
      <div className="glass-panel p-4 rounded-xl border border-dark-800 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
          <Filter size={14} />
          <span>Quick Filters</span>
        </div>

        <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
          {/* Class Select (only for Admin/Teacher) */}
          {user.role !== 'Student' && (
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none"
            >
              <option value="All">All Classes</option>
              {classes.map(c => <option key={c} value={c}>Class {c}</option>)}
            </select>
          )}

          {/* Subject Filter */}
          <select
            value={selectedSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none"
          >
            <option value="All">All Subjects</option>
            {filterSubjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Library Grid */}
      {loading ? (
        <div className="text-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-primary-500 mx-auto"></div>
        </div>
      ) : materials.length === 0 ? (
        <div className="glass-panel rounded-2xl border border-dark-850 p-12 text-center text-slate-500 text-sm">
          No learning resources uploaded for the selected combination.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {materials.map((material) => (
            <div key={material._id} className="glass-panel p-5 rounded-2xl border border-dark-800 flex flex-col justify-between hover:border-dark-700 hover:shadow-xl transition-all duration-200">
              <div className="space-y-4">
                {/* Subject & Class Headers */}
                <div className="flex justify-between items-center">
                  <span className="px-2 py-0.5 rounded bg-primary-950/60 border border-primary-850/40 text-[10px] font-bold text-primary-400">
                    {material.subject}
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Class {material.class_level}</span>
                </div>

                {/* Chapter Name & File Preview */}
                <div className="flex gap-3">
                  <div className="p-3 bg-dark-900 rounded-xl border border-dark-850 text-primary-400 h-fit self-start">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white leading-tight">{material.chapter_name}</h4>
                    <span className="text-[10px] text-slate-500 block mt-1 truncate max-w-[15rem]" title={material.file_name}>
                      {material.file_name}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status & Action Footer */}
              <div className="mt-6 pt-4 border-t border-dark-800/80 flex items-center justify-between">
                <div>
                  <span className="text-[9px] text-slate-500 block uppercase tracking-wider font-semibold">Delivery State</span>
                  {user.role !== 'Student' ? (
                    <select
                      value={material.status}
                      onChange={(e) => handleStatusChange(material._id, e.target.value)}
                      className={`px-2 py-0.5 mt-0.5 rounded text-[10px] font-bold border outline-none bg-dark-950 ${getStatusColor(material.status)}`}
                    >
                      {pipelineStates.map(state => <option key={state} value={state}>{state}</option>)}
                    </select>
                  ) : (
                    <span className={`px-2.5 py-0.5 mt-0.5 rounded text-[10px] font-bold border inline-block ${getStatusColor(material.status)}`}>
                      {material.status}
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  {/* Download Action */}
                  <a
                    href={material.file_url}
                    download={material.file_name}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-lg bg-dark-900 border border-dark-850 text-primary-400 hover:text-primary-300 hover:bg-dark-800 transition"
                  >
                    <FileDown size={14} />
                  </a>

                  {/* Delete Action (Admin/Teacher only) */}
                  {user.role !== 'Student' && (
                    <button
                      onClick={() => handleDeleteMaterial(material._id)}
                      className="p-2 rounded-lg bg-dark-900 border border-dark-850 text-rose-400 hover:text-rose-300 hover:bg-dark-800 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- HANDOUT UPLOAD MODAL --- */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glass-panel w-full max-w-md rounded-2xl border border-dark-800 overflow-hidden shadow-2xl relative animate-scaleUp">
            <div className="p-6 border-b border-dark-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-white font-outfit">Publish Learning Material</h3>
              <button onClick={() => setShowUploadModal(false)} className="text-slate-500 hover:text-white transition">
                <X size={20} />
              </button>
            </div>

            {error && (
              <div className="mx-6 mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleUploadSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Class Target</label>
                  <select
                    value={uploadForm.class_level}
                    onChange={(e) => setUploadForm({ ...uploadForm, class_level: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none"
                  >
                    {classes.map(c => <option key={c} value={c}>Class {c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Subject Category</label>
                  <select
                    value={uploadForm.subject}
                    onChange={(e) => setUploadForm({ ...uploadForm, subject: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none"
                  >
                    {uploadSubjects.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Chapter / Handout Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Chapter 4: Quadratic Equations"
                  value={uploadForm.chapter_name}
                  onChange={(e) => setUploadForm({ ...uploadForm, chapter_name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none focus:border-primary-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Delivery Pipeline</label>
                  <select
                    value={uploadForm.status}
                    onChange={(e) => setUploadForm({ ...uploadForm, status: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-lg bg-dark-900 border border-dark-850 text-white text-xs outline-none"
                  >
                    {pipelineStates.map(state => <option key={state} value={state}>{state}</option>)}
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">Select Document</label>
                  <input
                    type="file"
                    required
                    onChange={handleFileChange}
                    className="w-full text-slate-500 text-xs mt-1.5 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:bg-dark-900 file:text-slate-300 file:hover:bg-dark-800 file:cursor-pointer outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-dark-800">
                <button 
                  type="button" 
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-dark-900 border border-dark-850 text-slate-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={uploading}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition flex items-center gap-1.5"
                >
                  {uploading ? 'Uploading...' : 'Publish Handout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default LmsDownload;
