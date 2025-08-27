import React, { useState, useEffect } from 'react';
import { auth, firestore } from './firebase';
import {
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';

// The peer review application integrates Firebase Authentication
// and Firestore to persist data. Students authenticate using their
// Google accounts, and the configured administrator account has
// access to additional controls such as managing global settings
// and exporting or deleting all data.

const ADMIN_EMAIL = 'gunka.daniel@gmail.com';

const App = () => {
  // Combined state for database data loaded from Firestore
  const [dbData, setDbData] = useState({
    submissions: [],
    reviews: [],
    settings: {
      reviewsPerSubmission: 3,
      maxScore: 100,
    },
  });
  // Authenticated user (Firebase user object)
  const [currentUser, setCurrentUser] = useState(null);
  // True when the authenticated user has administrator privileges
  const [isTeacher, setIsTeacher] = useState(false);
  // Tab selection
  const [activeTab, setActiveTab] = useState('tab1');
  // UI modal state variables
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [currentReviewId, setCurrentReviewId] = useState(null);
  const [reviewScore, setReviewScore] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [pendingConfirmAction, setPendingConfirmAction] = useState(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [currentSubmissionId, setCurrentSubmissionId] = useState(null);
  // Column visibility persists locally to avoid storing UI preferences in Firestore
  const [columnVisibility, setColumnVisibility] = useState(() => {
    try {
      const saved = localStorage.getItem('columnVisibility');
      return saved
        ? JSON.parse(saved)
        : {
            submissionDate: false,
            pickupDate: false,
            correctionDate: false,
            link: true,
            score: true,
            comment: true,
            reviewer: true,
            status: true,
            sender: true,
          };
    } catch {
      return {
        submissionDate: false,
        pickupDate: false,
        correctionDate: false,
        link: true,
        score: true,
        comment: true,
        reviewer: true,
        status: true,
        sender: true,
      };
    }
  });
  // Sorting and filtering states for admin panel
  const [filterMenu, setFilterMenu] = useState({ column: null, open: false, value: '' });
  const [sort, setSort] = useState({ column: null, direction: 'none' });

  // Subscribe to Firebase Authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsTeacher(user?.email === ADMIN_EMAIL);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to Firestore collections/documents on mount
  useEffect(() => {
    // Submissions collection
    const unsubscribeSubmissions = onSnapshot(
      collection(firestore, 'submissions'),
      (snapshot) => {
        const submissions = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setDbData((prev) => ({ ...prev, submissions }));
      }
    );
    // Reviews collection
    const unsubscribeReviews = onSnapshot(
      collection(firestore, 'reviews'),
      (snapshot) => {
        const reviews = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setDbData((prev) => ({ ...prev, reviews }));
      }
    );
    // Settings document (single document with id "global")
    const settingsDocRef = doc(firestore, 'settings', 'global');
    const unsubscribeSettings = onSnapshot(settingsDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setDbData((prev) => ({ ...prev, settings: docSnap.data() }));
      }
    });
    return () => {
      unsubscribeSubmissions();
      unsubscribeReviews();
      unsubscribeSettings();
    };
  }, []);

  // Persist column visibility to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('columnVisibility', JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  // Utility to get today's date as YYYY-MM-DD
  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Google sign‑in handler. Initiates a pop‑up for the user to
  // authenticate with their Google account. Any errors are logged
  // to the console and surfaced to the user via confirm modal.
  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed:', error);
      showMessage('Přihlášení se nezdařilo. Zkuste to prosím znovu.');
    }
  };

  // Sign out the currently authenticated user
  const handleLogout = async () => {
    try {
      await signOut(auth);
      setActiveTab('tab1');
    } catch (error) {
      console.error('Logout failed:', error);
      showMessage('Odhlášení se nezdařilo.');
    }
  };

  // Add a new submission to Firestore. Validates that the URL is
  // present and begins with http. Uses the current user's email as
  // the author. Upon success the form clears automatically because
  // the DOM input value is passed in by the caller and reset outside.
  const handleAddSubmission = async () => {
    if (!currentUser) return;
    const linkInput = document.getElementById('submit-link-input');
    const link = linkInput.value.trim();
    if (!link || !link.startsWith('http')) {
      showMessage('Prosím, zadejte platný URL odkaz.');
      return;
    }
    try {
      await addDoc(collection(firestore, 'submissions'), {
        author: currentUser.email,
        link: link,
        status: 'Odesláno',
        reviewCount: 0,
        submissionDate: getTodayDate(),
        pickupDate: null,
        correctionDate: null,
      });
      linkInput.value = '';
    } catch (error) {
      console.error('Failed to add submission:', error);
      showMessage('Přidání práce se nezdařilo.');
    }
  };

  // Delete a submission and its associated reviews from Firestore
  const handleDeleteSubmission = async (id) => {
    try {
      // Delete associated reviews first
      const reviewsQuery = query(collection(firestore, 'reviews'), where('submissionId', '==', id));
      const reviewsSnapshot = await getDocs(reviewsQuery);
      for (const reviewDoc of reviewsSnapshot.docs) {
        await deleteDoc(doc(firestore, 'reviews', reviewDoc.id));
      }
      // Delete the submission
      await deleteDoc(doc(firestore, 'submissions', id));
      setConfirmModalOpen(false);
    } catch (error) {
      console.error('Failed to delete submission:', error);
      showMessage('Smazání práce se nezdařilo.');
    }
  };

  // Delete a review record from Firestore
  const handleDeleteReview = async (reviewId) => {
    try {
      await deleteDoc(doc(firestore, 'reviews', reviewId));
      setConfirmModalOpen(false);
    } catch (error) {
      console.error('Failed to delete review:', error);
      showMessage('Smazání hodnocení se nezdařilo.');
    }
  };

  // Completely remove all submissions, reviews and settings. This operation
  // cannot be undone. Only accessible to the administrator.
  const handleDeleteAllData = async () => {
    try {
      // Delete all reviews
      const reviewsSnapshot = await getDocs(collection(firestore, 'reviews'));
      for (const reviewDoc of reviewsSnapshot.docs) {
        await deleteDoc(doc(firestore, 'reviews', reviewDoc.id));
      }
      // Delete all submissions
      const submissionsSnapshot = await getDocs(collection(firestore, 'submissions'));
      for (const submissionDoc of submissionsSnapshot.docs) {
        await deleteDoc(doc(firestore, 'submissions', submissionDoc.id));
      }
      // Reset global settings document
      await setDoc(doc(firestore, 'settings', 'global'), {
        reviewsPerSubmission: 3,
        maxScore: 100,
      });
      setConfirmModalOpen(false);
    } catch (error) {
      console.error('Failed to delete all data:', error);
      showMessage('Smazání dat se nezdařilo.');
    }
  };

  // Request a new submission to review. Chooses a random submission that
  // is not authored by the current user and has not yet been reviewed by
  // them. Once selected, creates a new review document and updates the
  // pickup date on the submission.
  const handleGetWorkToReview = async () => {
    if (!currentUser) return;
    // Determine available submissions client‑side. Note: the data
    // consistency of this approach can be improved by using Cloud
    // Functions or transactions, but for small demo purposes it's OK.
    const availableSubmissions = dbData.submissions.filter(
      (s) =>
        s.author !== currentUser.email &&
        !dbData.reviews.some((r) => r.submissionId === s.id && r.reviewer === currentUser.email)
    );
    if (availableSubmissions.length === 0) {
      showMessage('Není k dispozici žádná práce k hodnocení. Zkuste to prosím později.');
      return;
    }
    const newSubmission = availableSubmissions[Math.floor(Math.random() * availableSubmissions.length)];
    try {
      // Create a new review document
      await addDoc(collection(firestore, 'reviews'), {
        submissionId: newSubmission.id,
        reviewer: currentUser.email,
        status: 'assigned',
        score: null,
        comment: '',
        pickupDate: getTodayDate(),
        correctionDate: null,
      });
      // Update the pickup date on the submission
      await updateDoc(doc(firestore, 'submissions', newSubmission.id), {
        pickupDate: getTodayDate(),
      });
    } catch (error) {
      console.error('Failed to assign submission:', error);
      showMessage('Při přidělování práce k hodnocení došlo k chybě.');
    }
  };

  // Show the review modal for editing a review
  const showReviewModal = (reviewId) => {
    const review = dbData.reviews.find((r) => r.id === reviewId);
    if (review) {
      setCurrentReviewId(reviewId);
      setReviewScore(review.score !== null ? review.score : '');
      setReviewComment(review.comment || '');
      setReviewModalOpen(true);
    }
  };

  // Submit changes to a review: score and comment. Updates the review
  // document and the corresponding submission document with a correction
  // date if appropriate.
  const handleSubmitReview = async () => {
    if (!currentReviewId) return;
    const score = parseInt(reviewScore, 10);
    const comment = reviewComment.trim();
    if (isNaN(score) || score < 0 || score > dbData.settings.maxScore) {
      showMessage(`Prosím, zadejte hodnocení v rozmezí 0-${dbData.settings.maxScore} bodů.`);
      return;
    }
    try {
      // Update review document
      await updateDoc(doc(firestore, 'reviews', currentReviewId), {
        score: score,
        comment: comment,
        status: 'finished',
        correctionDate: getTodayDate(),
      });
      // Update corresponding submission's correction date
      const review = dbData.reviews.find((r) => r.id === currentReviewId);
      if (review) {
        await updateDoc(doc(firestore, 'submissions', review.submissionId), {
          correctionDate: getTodayDate(),
        });
      }
      setReviewModalOpen(false);
      setReviewScore('');
      setReviewComment('');
    } catch (error) {
      console.error('Failed to submit review:', error);
      showMessage('Odeslání hodnocení se nezdařilo.');
    }
  };

  // Save global settings (reviews per submission and maximum score)
  const handleSaveSettings = async () => {
    const reviewCountInput = document.getElementById('review-count');
    const maxScoreInput = document.getElementById('max-score');
    const reviewCount = parseInt(reviewCountInput.value, 10);
    const maxScore = parseInt(maxScoreInput.value, 10);
    if (
      isNaN(reviewCount) ||
      reviewCount <= 0 ||
      isNaN(maxScore) ||
      maxScore < 0 ||
      maxScore > 100
    ) {
      showMessage('Prosím, zadejte platné hodnoty pro nastavení. Počet hodnocení > 0, Max. body 0-100.');
      return;
    }
    try {
      await setDoc(doc(firestore, 'settings', 'global'), {
        reviewsPerSubmission: reviewCount,
        maxScore: maxScore,
      });
      showMessage('Nastavení bylo uloženo.');
    } catch (error) {
      console.error('Failed to save settings:', error);
      showMessage('Ukládání nastavení se nezdařilo.');
    }
  };

  // Show details for a specific submission. Opens a modal listing all
  // associated reviews.
  const showDetailModal = (submissionId) => {
    setCurrentSubmissionId(submissionId);
    setDetailModalOpen(true);
  };

  // Export current aggregated review data into a CSV file. This function
  // mirrors the behaviour from the legacy localStorage implementation but
  // operates on Firestore data. Note: since this runs client‑side it
  // synthesizes the CSV and triggers a download via a temporary link.
  const handleExportToExcel = () => {
    const rows = filteredAndSortedReviews().map((item) => {
      // We need to determine whether the item is a submission or review
      if (item.type === 'submission') {
        return {
          odesilatel: item.sender,
          odkaz: item.submissionLink,
          recenzent: 'N/A',
          stav_recenze: 'Nevyzvednuto',
          hodnoceni: 'N/A',
          komentar: 'N/A',
          datum_odeslani: item.submissionDate || 'N/A',
          datum_vyzvednuti: 'N/A',
          datum_opravy: 'N/A',
        };
      } else {
        return {
          odesilatel: item.sender || 'N/A',
          odkaz: item.submissionLink || 'N/A',
          recenzent: item.reviewer || 'N/A',
          stav_recenze: item.status === 'finished' ? 'Zkontrolováno' : 'Vyzvednuto',
          hodnoceni:
            item.score !== null
              ? `${item.score} / ${dbData.settings.maxScore}`
              : 'N/A',
          komentar: item.comment || 'Žádná poznámka',
          datum_odeslani: item.submissionDate || 'N/A',
          datum_vyzvednuti: item.pickupDate || 'N/A',
          datum_opravy: item.correctionDate || 'N/A',
        };
      }
    });
    const csvRows = [];
    const headers = [
      'Odesilatel',
      'Odkaz',
      'Recenzent',
      'Stav recenze',
      'Hodnocení',
      'Komentář',
      'Datum odeslání',
      'Datum vyzvednutí',
      'Datum opravy',
    ];
    csvRows.push(headers.join(';'));
    for (const row of rows) {
      const values = headers.map((header) => {
        const key = header.toLowerCase().replace(/ /g, '_');
        const value = row[key];
        return `"${(value || '').toString().replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(';'));
    }
    const csvString = csvRows.join('\n');
    const blob = new Blob([
      new Uint8Array([0xef, 0xbb, 0xbf]),
      csvString,
    ], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'prehled_hodnoceni.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Show a confirmation modal with a custom message and callback. If
  // action is null, displays an OK-only modal without yes/no buttons.
  const showConfirmModal = (message, action) => {
    setConfirmMessage(message);
    setPendingConfirmAction(() => action);
    setConfirmModalOpen(true);
  };

  // Show a message to the user (used as a replacement for alert). This
  // always displays a single OK button.
  const showMessage = (message) => {
    setConfirmMessage(message);
    setPendingConfirmAction(null);
    setConfirmModalOpen(true);
  };

  // Toggle filter menu visibility for a given column
  const toggleFilterMenu = (column, event) => {
    event.stopPropagation();
    setFilterMenu((prev) =>
      prev.column === column && prev.open
        ? { column: null, open: false, value: '' }
        : { column, open: true, value: '' }
    );
  };
  const handleFilterChange = (value) => {
    setFilterMenu((prev) => ({ ...prev, value }));
  };
  // Sort data by column; toggles between ascending, descending and none
  const handleSort = (column) => {
    setSort((prev) => {
      if (prev.column === column) {
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        if (prev.direction === 'desc') return { column: null, direction: 'none' };
        return { column, direction: 'asc' };
      }
      return { column, direction: 'asc' };
    });
  };
  // Toggle column visibility for admin panel
  const toggleColumnVisibility = (column) => {
    setColumnVisibility((prev) => ({ ...prev, [column]: !prev[column] }));
  };

  // Construct a unified list of submissions and reviews for filtering and sorting
  const filteredAndSortedReviews = () => {
    const allItems = dbData.submissions
      .map((sub) => {
        const reviewsForSub = dbData.reviews.filter((r) => r.submissionId === sub.id);
        if (reviewsForSub.length > 0) {
          return reviewsForSub.map((rev) => ({
            ...rev,
            type: 'review',
            sender: sub.author,
            submissionLink: sub.link,
            submissionDate: sub.submissionDate,
            pickupDate: rev.pickupDate,
            correctionDate: rev.correctionDate,
            statusText: rev.status === 'finished' ? 'Zkontrolováno' : 'Vyzvednuto',
          }));
        }
        return [
          {
            ...sub,
            type: 'submission',
            sender: sub.author,
            submissionLink: sub.link,
            status: 'unassigned',
            statusText: 'Nevyzvednuto',
            reviewer: 'N/A',
            score: null,
            comment: '',
            submissionDate: sub.submissionDate,
            pickupDate: null,
            correctionDate: null,
          },
        ];
      })
      .flat();
    // Filter
    const filtered = allItems.filter((item) => {
      if (filterMenu.column === 'sender' && filterMenu.value !== '') {
        return (item.sender || '').toLowerCase().includes(filterMenu.value.toLowerCase());
      }
      if (filterMenu.column === 'reviewer' && filterMenu.value !== '') {
        return (item.reviewer || '').toLowerCase().includes(filterMenu.value.toLowerCase());
      }
      if (filterMenu.column === 'status' && filterMenu.value !== '') {
        return item.status === filterMenu.value;
      }
      if (filterMenu.column === 'score' && filterMenu.value !== '' && item.type === 'review') {
        const [min, max] = filterMenu.value.split('-').map(Number);
        if (!isNaN(min) && !isNaN(max)) {
          return item.score >= min && item.score <= max;
        } else if (!isNaN(min)) {
          return item.score >= min;
        } else if (!isNaN(max)) {
          return item.score <= max;
        }
        return false;
      }
      return true;
    });
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      if (!sort.column || sort.direction === 'none') return 0;
      let aValue;
      let bValue;
      switch (sort.column) {
        case 'sender':
        case 'reviewer':
        case 'submissionLink':
        case 'submissionDate':
        case 'pickupDate':
        case 'correctionDate':
        case 'status':
          aValue = a[sort.column];
          bValue = b[sort.column];
          break;
        case 'score':
          aValue = a.type === 'review' && a.score !== null ? a.score : -1;
          bValue = b.type === 'review' && b.score !== null ? b.score : -1;
          break;
        case 'comment':
          aValue = a.type === 'review' ? (a.comment || '').length : 0;
          bValue = b.type === 'review' ? (b.comment || '').length : 0;
          break;
        default:
          return 0;
      }
      if (typeof aValue === 'string') {
        return sort.direction === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }
      return sort.direction === 'asc' ? aValue - bValue : bValue - aValue;
    });
    return sorted;
  };

  // Render UI based on authentication state
  const renderApp = () => {
    // If user is not logged in, show Google sign‑in button
    if (!currentUser) {
      return (
        <div id="login-section" className="flex flex-col items-center justify-center space-y-4">
          <h1 className="text-3xl font-bold text-gray-800">Přihlaste se prosím</h1>
          <button
            id="login-btn"
            className="bg-green-500 text-white font-semibold py-2 px-6 rounded-lg shadow hover:bg-green-600 transition duration-300"
            onClick={handleLogin}
          >
            Přihlásit se pomocí Googlu
          </button>
        </div>
      );
    }
    // Main application UI
    return (
      <div id="main-app">
        <div className="flex justify-between items-center mb-6">
          <div className="flex space-x-2">
            <button
              className={`tab-button px-4 py-2 text-gray-600 hover:text-green-500 font-medium ${
                activeTab === 'tab1' ? 'active text-green-500 border-b-2 border-green-500' : ''
              }`}
              onClick={() => setActiveTab('tab1')}
            >
              1. Moje práce
            </button>
            <button
              className={`tab-button px-4 py-2 text-gray-600 hover:text-green-500 font-medium ${
                activeTab === 'tab2' ? 'active text-green-500 border-b-2 border-green-500' : ''
              }`}
              onClick={() => setActiveTab('tab2')}
            >
              2. Hodnocení prací
            </button>
            {isTeacher && (
              <button
                className={`tab-button px-4 py-2 text-gray-600 hover:text-green-500 font-medium ${
                  activeTab === 'tab3' ? 'active text-green-500 border-b-2 border-green-500' : ''
                }`}
                onClick={() => setActiveTab('tab3')}
              >
                3. Admin panel
              </button>
            )}
          </div>
          <button
            id="logout-btn"
            className="bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-lg shadow hover:bg-gray-400 transition duration-300"
            onClick={handleLogout}
          >
            Odhlásit
          </button>
        </div>
        {activeTab === 'tab1' && (
          <div id="tab1" className="tab-content active">
            <h2 className="text-2xl font-semibold mb-4 text-gray-700">Moje odeslané práce</h2>
            <div className="bg-gray-50 p-4 rounded-xl mb-6 shadow-sm">
              <h3 className="font-bold text-gray-600 mb-2">Odeslat novou práci</h3>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-end space-y-2 sm:space-y-0 sm:space-x-2">
                <input
                  type="url"
                  id="submit-link-input"
                  placeholder="Vložte odkaz na svou práci (např. Google Docs)"
                  className="px-4 py-2 border border-gray-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  id="submit-work-btn"
                  className="bg-green-500 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-green-600 transition duration-300 whitespace-nowrap"
                  onClick={handleAddSubmission}
                >
                  Odeslat
                </button>
              </div>
            </div>
            <div className="bg-gray-50 p-4 rounded-xl shadow-sm">
              <h3 className="font-bold text-gray-600 mb-2">Stav mých prací</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow overflow-hidden">
                  <thead>
                    <tr className="bg-gray-200 text-gray-600 uppercase text-sm leading-normal">
                      <th className="py-3 px-6 text-left">Odkaz</th>
                      <th className="py-3 px-6 text-left">Stav</th>
                      <th className="py-3 px-6 text-left">Datum odeslání</th>
                      <th className="py-3 px-6 text-center">Akce</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-600 text-sm font-light">
                    {dbData.submissions.filter((s) => s.author === currentUser.email).length === 0 ? (
                      <tr>
                        <td colSpan="4" className="text-center py-4 text-gray-500">
                          Zatím jste neodeslal žádnou práci.
                        </td>
                      </tr>
                    ) : (
                      dbData.submissions
                        .filter((s) => s.author === currentUser.email)
                        .map((sub) => {
                          const reviewsDone = dbData.reviews.filter(
                            (r) => r.submissionId === sub.id && r.status === 'finished'
                          ).length;
                          const reviewsNeeded = dbData.settings.reviewsPerSubmission;
                          return (
                            <tr key={sub.id} className="border-b border-gray-200 hover:bg-gray-100">
                              <td className="py-3 px-6 text-left whitespace-nowrap">
                                <a
                                  href={sub.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:underline"
                                >
                                  {sub.link.length > 40 ? sub.link.substring(0, 37) + '...' : sub.link}
                                </a>
                              </td>
                              <td className="py-3 px-6 text-left">
                                <span className="bg-gray-200 text-gray-600 py-1 px-3 rounded-full text-xs font-semibold">
                                  {reviewsDone} / {reviewsNeeded} Zkontrolováno
                                </span>
                                {reviewsDone > 0 && (
                                  <button
                                    onClick={() => showDetailModal(sub.id)}
                                    className="ml-2 text-blue-500 hover:underline text-xs"
                                  >
                                    Zobrazit hodnocení
                                  </button>
                                )}
                              </td>
                              <td className="py-3 px-6 text-left whitespace-nowrap">{sub.submissionDate}</td>
                              <td className="py-3 px-6 text-center">
                                <button
                                  onClick={() =>
                                    showConfirmModal(
                                      'Opravdu chcete smazat tuto práci a všechna její hodnocení?',
                                      () => handleDeleteSubmission(sub.id)
                                    )
                                  }
                                  className="bg-red-200 text-red-600 py-1 px-3 rounded-full text-xs hover:bg-red-300 transition duration-200"
                                >
                                  Smazat
                                </button>
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-sm text-gray-500">
                <p>
                  <strong>Poznámka:</strong> Počet potřebných hodnocení je nastaven na
                  {dbData.settings.reviewsPerSubmission}.
                </p>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'tab2' && (
          <div id="tab2" className="tab-content active">
            <h2 className="text-2xl font-semibold mb-4 text-gray-700">Hodnocení prací ostatních</h2>
            <div className="bg-gray-50 p-4 rounded-xl mb-6 shadow-sm">
              <div className="flex items-center flex-wrap space-y-2 sm:space-y-0 space-x-0 sm:space-x-2">
                <button
                  id="get-work-btn"
                  className="bg-green-500 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-green-600 transition duration-300 whitespace-nowrap"
                  onClick={handleGetWorkToReview}
                >
                  Získat práci k hodnocení
                </button>
                <span className="text-gray-600 text-sm">
                  Máte k hodnocení {dbData.reviews.filter((r) => r.reviewer === currentUser.email).length}
                  {' '}prací.
                </span>
              </div>
            </div>
            <div className="bg-gray-50 p-4 rounded-xl shadow-sm">
              <h3 className="font-bold text-gray-600 mb-2">Práce k hodnocení</h3>
              <div id="reviews-list" className="space-y-4">
                {dbData.reviews.filter((r) => r.reviewer === currentUser.email).length === 0 ? (
                  <p className="text-center text-gray-500 mt-4">
                    V současné době nemáte žádné práce k hodnocení.
                  </p>
                ) : (
                  dbData.reviews
                    .filter((r) => r.reviewer === currentUser.email)
                    .map((review) => {
                      const submission = dbData.submissions.find((s) => s.id === review.submissionId);
                      if (!submission) return null;
                      return (
                        <div
                          key={review.id}
                          className="bg-white p-4 rounded-lg shadow flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-2 sm:space-y-0"
                        >
                          <div className="flex-1">
                            <a
                              href={submission.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:underline font-medium break-all"
                            >
                              {submission.link}
                            </a>
                            <p className="text-sm text-gray-500">
                              Stav:{' '}
                              <span
                                className={`py-1 px-2 rounded-full text-xs font-semibold ${
                                  review.status === 'finished'
                                    ? 'bg-green-200 text-green-600'
                                    : 'bg-gray-200 text-gray-800'
                                }`}
                              >
                                {review.status === 'finished' ? 'Zkontrolováno' : 'Vyzvednuto'}
                              </span>
                            </p>
                          </div>
                          <div className="mt-2 sm:mt-0">
                            {review.status !== 'finished' ? (
                              <button
                                onClick={() => showReviewModal(review.id)}
                                className="bg-green-500 text-white font-semibold py-1 px-3 rounded-lg hover:bg-green-600 transition duration-300"
                              >
                                Dokončit hodnocení
                              </button>
                            ) : (
                              <span className="text-green-600 font-semibold">Dokončeno</span>
                            )}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'tab3' && isTeacher && (
          <div id="tab3" className="tab-content active">
            <h2 className="text-2xl font-semibold mb-4 text-gray-700">Administrátorský panel</h2>
            <div className="bg-gray-50 p-4 rounded-xl mb-6 shadow-sm">
              <h3 className="font-bold text-gray-600 mb-2">Nastavení</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="review-count" className="block text-gray-600">
                    Počet hodnocení na práci:
                  </label>
                  <input
                    type="number"
                    id="review-count"
                    min="1"
                    defaultValue={dbData.settings.reviewsPerSubmission}
                    className="mt-1 px-4 py-2 border border-gray-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label htmlFor="max-score" className="block text-gray-600">
                    Maximální počet bodů:
                  </label>
                  <input
                    type="number"
                    id="max-score"
                    min="0"
                    max="100"
                    defaultValue={dbData.settings.maxScore}
                    className="mt-1 px-4 py-2 border border-gray-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              </div>
              <div className="mt-4">
                <button
                  id="save-settings-btn"
                  className="bg-green-500 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-green-600 transition duration-300 w-full sm:w-auto"
                  onClick={handleSaveSettings}
                >
                  Uložit nastavení
                </button>
              </div>
            </div>
            <div className="bg-gray-50 p-4 rounded-xl shadow-sm">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 space-y-2 sm:space-y-0">
                <h3 className="font-bold text-gray-600">Celkový přehled</h3>
                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                  <button
                    id="export-btn"
                    className="bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-blue-600 transition duration-300 whitespace-nowrap"
                    onClick={handleExportToExcel}
                  >
                    Export do Excelu
                  </button>
                  <button
                    id="delete-all-btn"
                    className="bg-red-500 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-red-600 transition duration-300 whitespace-nowrap"
                    onClick={() =>
                      showConfirmModal(
                        'Opravdu chcete smazat VŠECHNA data? Tato akce je nevratná.',
                        handleDeleteAllData
                      )
                    }
                  >
                    Smazat vše
                  </button>
                </div>
              </div>
              {/* Column visibility controls */}
              <div className="flex flex-wrap gap-4 mb-4 text-sm text-gray-600">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded text-green-500"
                    checked={columnVisibility.submissionDate}
                    onChange={() => toggleColumnVisibility('submissionDate')}
                  />
                  <span>Datum odeslání</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded text-green-500"
                    checked={columnVisibility.pickupDate}
                    onChange={() => toggleColumnVisibility('pickupDate')}
                  />
                  <span>Datum vyzvednutí</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded text-green-500"
                    checked={columnVisibility.correctionDate}
                    onChange={() => toggleColumnVisibility('correctionDate')}
                  />
                  <span>Datum opravy</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded text-green-500"
                    checked={columnVisibility.link}
                    onChange={() => toggleColumnVisibility('link')}
                  />
                  <span>Odkaz</span>
                </label>
              </div>
              {/* Table for aggregated data */}
              <div className="overflow-x-auto relative">
                <table className="min-w-full bg-white rounded-xl shadow overflow-hidden">
                  <thead>
                    <tr className="bg-gray-200 text-gray-600 uppercase text-sm leading-normal">
                      {columnVisibility.sender && (
                        <th
                          className="py-3 px-6 text-left cursor-pointer"
                          onClick={() => handleSort('sender')}
                        >
                          Odesilatel
                        </th>
                      )}
                      {columnVisibility.link && (
                        <th
                          className="py-3 px-6 text-left cursor-pointer"
                          onClick={() => handleSort('submissionLink')}
                        >
                          Odkaz
                        </th>
                      )}
                      {columnVisibility.reviewer && (
                        <th
                          className="py-3 px-6 text-left cursor-pointer"
                          onClick={() => handleSort('reviewer')}
                        >
                          Recenzent
                        </th>
                      )}
                      {columnVisibility.status && (
                        <th
                          className="py-3 px-6 text-left cursor-pointer"
                          onClick={() => handleSort('status')}
                        >
                          Stav recenze
                        </th>
                      )}
                      {columnVisibility.submissionDate && (
                        <th
                          className="py-3 px-6 text-left cursor-pointer"
                          onClick={() => handleSort('submissionDate')}
                        >
                          Datum odeslání
                        </th>
                      )}
                      {columnVisibility.pickupDate && (
                        <th
                          className="py-3 px-6 text-left cursor-pointer"
                          onClick={() => handleSort('pickupDate')}
                        >
                          Datum vyzvednutí
                        </th>
                      )}
                      {columnVisibility.correctionDate && (
                        <th
                          className="py-3 px-6 text-left cursor-pointer"
                          onClick={() => handleSort('correctionDate')}
                        >
                          Datum opravy
                        </th>
                      )}
                      {columnVisibility.score && (
                        <th
                          className="py-3 px-6 text-left cursor-pointer"
                          onClick={() => handleSort('score')}
                        >
                          Hodnocení
                        </th>
                      )}
                      {columnVisibility.comment && (
                        <th
                          className="py-3 px-6 text-left cursor-pointer"
                          onClick={() => handleSort('comment')}
                        >
                          Komentář
                        </th>
                      )}
                      <th className="py-3 px-6 text-center">Akce</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-600 text-sm font-light">
                    {filteredAndSortedReviews().length === 0 ? (
                      <tr>
                        <td colSpan="10" className="text-center py-4 text-gray-500">
                          Žádné záznamy neodpovídají filtrům.
                        </td>
                      </tr>
                    ) : (
                      filteredAndSortedReviews().map((item) => {
                        // Determine the unique key for row (review id or submission id)
                        const recordId = item.type === 'submission' ? item.id : item.id;
                        const statusColor =
                          item.status === 'finished'
                            ? 'bg-green-200 text-green-600'
                            : item.status === 'assigned'
                            ? 'bg-yellow-200 text-yellow-600'
                            : 'bg-red-200 text-red-600';
                        return (
                          <tr key={recordId} className="border-b border-gray-200 hover:bg-gray-100">
                            {columnVisibility.sender && <td className="py-3 px-6 text-left">{item.sender}</td>}
                            {columnVisibility.link && (
                              <td className="py-3 px-6 text-left">
                                <a
                                  href={item.submissionLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-500 hover:underline break-all"
                                >
                                  {item.submissionLink.length > 40
                                    ? item.submissionLink.substring(0, 37) + '...'
                                    : item.submissionLink}
                                </a>
                              </td>
                            )}
                            {columnVisibility.reviewer && <td className="py-3 px-6 text-left">{item.reviewer || 'N/A'}</td>}
                            {columnVisibility.status && (
                              <td className="py-3 px-6 text-left">
                                <span className={`py-1 px-2 rounded-full text-xs font-semibold ${statusColor}`}>
                                  {item.statusText}
                                </span>
                              </td>
                            )}
                            {columnVisibility.submissionDate && <td className="py-3 px-6 text-left">{item.submissionDate || 'N/A'}</td>}
                            {columnVisibility.pickupDate && <td className="py-3 px-6 text-left">{item.pickupDate || 'N/A'}</td>}
                            {columnVisibility.correctionDate && <td className="py-3 px-6 text-left">{item.correctionDate || 'N/A'}</td>}
                            {columnVisibility.score && (
                              <td className="py-3 px-6 text-left">
                                {item.score !== null ? `${item.score} / ${dbData.settings.maxScore}` : 'N/A'}
                              </td>
                            )}
                            {columnVisibility.comment && (
                              <td className="py-3 px-6 text-left">{item.comment || 'Žádná poznámka'}</td>
                            )}
                            <td className="py-3 px-6 text-center">
                              <button
                                onClick={() =>
                                  showConfirmModal(
                                    'Opravdu chcete smazat tento záznam?',
                                    () => {
                                      if (item.type === 'submission') {
                                        handleDeleteSubmission(item.id);
                                      } else {
                                        handleDeleteReview(item.id);
                                      }
                                    }
                                  )
                                }
                                className="bg-red-200 text-red-600 py-1 px-3 rounded-full text-xs hover:bg-red-300 transition duration-200"
                              >
                                Smazat
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {/* Review modal */}
        {reviewModalOpen && (
          <div id="review-modal" className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg mx-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Odeslat hodnocení</h3>
                <button
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                  onClick={() => setReviewModalOpen(false)}
                >
                  &times;
                </button>
              </div>
              <div className="mb-4">
                <label htmlFor="review-score" className="block text-gray-700">
                  Hodnocení (0-{dbData.settings.maxScore} bodů):
                </label>
                <input
                  type="number"
                  id="review-score"
                  min="0"
                  max={dbData.settings.maxScore}
                  value={reviewScore}
                  onChange={(e) => setReviewScore(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-green-500 focus:border-green-500"
                />
              </div>
              <div className="mb-4">
                <label htmlFor="review-comment" className="block text-gray-700">
                  Poznámka:
                </label>
                <textarea
                  id="review-comment"
                  rows="4"
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-green-500 focus:border-green-500"
                ></textarea>
              </div>
              <div className="flex justify-end">
                <button
                  id="submit-review-btn"
                  className="bg-green-500 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-green-600 transition duration-300"
                  onClick={handleSubmitReview}
                >
                  Odeslat hodnocení
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Confirmation / message modal */}
        {confirmModalOpen && (
          <div id="confirm-modal" className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg mx-auto">
              <p id="confirm-message" className="text-lg font-semibold mb-4 text-center">
                {confirmMessage}
              </p>
              <div className="flex justify-center space-x-4">
                {pendingConfirmAction ? (
                  <>
                    <button
                      id="confirm-yes"
                      className="bg-red-500 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-red-600 transition duration-300"
                      onClick={() => {
                        if (pendingConfirmAction) pendingConfirmAction();
                        setConfirmModalOpen(false);
                      }}
                    >
                      Ano
                    </button>
                    <button
                      id="confirm-no"
                      className="bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-lg shadow hover:bg-gray-400 transition duration-300"
                      onClick={() => setConfirmModalOpen(false)}
                    >
                      Zrušit
                    </button>
                  </>
                ) : (
                  <button
                    id="confirm-ok"
                    className="bg-green-500 text-white font-semibold py-2 px-4 rounded-lg shadow hover:bg-green-600 transition duration-300"
                    onClick={() => setConfirmModalOpen(false)}
                  >
                    OK
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {/* Detail modal for viewing all reviews of a submission */}
        {detailModalOpen && (
          <div id="detail-modal" className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg mx-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Detail hodnocení</h3>
                <button
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                  onClick={() => setDetailModalOpen(false)}
                >
                  &times;
                </button>
              </div>
              <div className="space-y-4">
                {dbData.reviews.filter((r) => r.submissionId === currentSubmissionId).length > 0 ? (
                  dbData.reviews
                    .filter((r) => r.submissionId === currentSubmissionId)
                    .map((review) => (
                      <div key={review.id} className="p-4 rounded-lg border border-gray-200">
                        <p>
                          <strong>Recenzent:</strong> {review.reviewer}
                        </p>
                        <p>
                          <strong>Hodnocení:</strong>{' '}
                          {review.score !== null ? `${review.score} / ${dbData.settings.maxScore}` : 'Nezadáno'}
                        </p>
                        <p>
                          <strong>Komentář:</strong> {review.comment || 'Žádná poznámka'}
                        </p>
                      </div>
                    ))
                ) : (
                  <p>Tato práce zatím nemá žádná hodnocení.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="font-sans antialiased text-gray-900 bg-gray-100 min-h-screen p-4 sm:p-8">
      <header className="mb-6 text-center">
        <h1 className="text-4xl font-extrabold text-gray-800">Systém peer-review</h1>
        {currentUser && (
          <p className="text-gray-600 mt-2">
            Přihlášen jako:{' '}
            <span className="font-semibold text-green-600">{currentUser.email}</span>
          </p>
        )}
      </header>
      <main className="max-w-4xl mx-auto bg-white rounded-3xl shadow-2xl p-4 sm:p-8">
        {renderApp()}
      </main>
    </div>
  );
};

export default App;