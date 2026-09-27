import "./App.css";

import { Routes, Route, Navigate } from "react-router-dom";

import Home from "./pages/Home.jsx";
import Navbar from "./components/Navbar.jsx";
import JobDetails from "./pages/JobDetails.jsx";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";
import DashboardLayout from "./pages/DashboardLayout.jsx";
import BlockedUsers from "./components/BlockedUsers.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import PostWork from "./pages/PostWork.jsx";
import EditWork from "./pages/EditWork.jsx";
import MyJobs from "./pages/MyJobs.jsx";
import Applicants from "./pages/Applicants.jsx";
import MyApplications from "./pages/MyApplications.jsx";
import Profile from "./pages/Profile.jsx";
import UserProfile from "./pages/UserProfile.jsx";
import Chat from "./pages/Chat";
import ForgotPassword from "./pages/ForgotPassword.jsx";

function App() {
  return (
    <div className="app">

      <Navbar />

      <Routes>

        {/* HOME PAGE */}
       <Route path="/" element={<Home />} />


        {/* JOB DETAILS PAGE */}
        <Route
          path="/jobs/:jobId"
          element={<JobDetails />}
        />


        {/* LOGIN */}
        <Route
          path="/login"
          element={<Login />}
        />

        {/* FORGOT PASSWORD */}
         <Route
            path="/forgot-password"
            element={<ForgotPassword />}
         />


        {/* SIGNUP */}
        <Route
          path="/signup"
          element={<Signup />}
        />


        {/* DASHBOARD */}
        <Route
          path="/dashboard"
          element={<DashboardLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="posted" element={<MyJobs />} />
          <Route path="applications" element={<MyApplications />} />
          <Route path="accepted" element={<MyApplications fixedStatus="accepted" />} />
          <Route path="completed" element={<MyApplications fixedStatus="completed" />} />
          <Route path="profile" element={<Profile showBlockedUsers={false} />} />
          <Route path="blocked" element={<main className="karviam-internal workspace-blocked"><BlockedUsers /></main>} />
        </Route>


        {/* POST WORK */}
        <Route
          path="/post-work"
          element={<PostWork />}
        />

        {/* EDIT WORK */}
        <Route
            path="/my-jobs/:jobId/edit"
            element={<EditWork />}
        />
       
         {/* MY JOBS */}
        <Route
            path="/my-jobs"
             element={<Navigate to="/dashboard/posted" replace />}
        />

         {/* JOBS APPLICANTS */}
        <Route
             path="/jobs/:jobId/applicants"
              element={<Applicants />}
        />

          {/* MyAPPLICANTS */}
        <Route
              path="/my-applications"
               element={<Navigate to="/dashboard/applications" replace />}
        />
         <Route
               path="/profile"
               element={<Navigate to="/dashboard/profile" replace />}
        />
        <Route
              path="/users/:userId"
               element={<UserProfile />}
        />

        <Route
               path="/applications/:applicationId/chat"
                element={<Chat />}
        />
        

      </Routes>

    </div>
  );
}

export default App;