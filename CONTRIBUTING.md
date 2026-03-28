# 🤝 Contributing to DreamBees

We're thrilled you're interested in helping us build the future of AI-powered creativity on Discord! The DreamBees Hive is a community of creators, and your contributions and ideas are vital.

---

## 🛠️ Developer Setup & workflow

### 1. Fork & Clone
Start by forking the official repository and cloning it to your local machine.

### 2. Environment Alignment
Copy the `.env.example` and fill it with your development credentials. 
> [!IMPORTANT]
> Use a dedicated Discord Test Bot and Firebase Project for development to avoid impacting production data.

### 3. Branching Strategy
We follow a standard feature-branch workflow:
- `main`: The stable, production-ready code.
- `feature/name`: New features or enhancements.
- `fix/name`: Bug fixes.

### 4. Code Standards
- **ESM (ECMAScript Modules)**: Use `import`/`export` exclusively. No `require`.
- **Async/Await**: Preferred over raw promises or callbacks.
- **Linting**: Run `npm run lint` before submitting a Pull Request. We follow the project's ESLint configuration (`eslint.config.js`).

---

## 🧪 Testing Your Changes

Before submitting, ensure your changes don't break the Hive:
- **Unit Tests**: Run `npm test` (Uses Jest).
- **Manual Verification**: Test the new slash command or interaction in your Discord test server.
- **Health Check**: Run `node scripts/health-check.js` to verify connectivity.

---

## 🚀 Submitting a Pull Request

1. **Keep PRs Focused**: One feature or fix per PR.
2. **Detailed Description**: Explain *what* changed and *why*.
3. **Include Screenshots/Recordings**: For any UI or interaction changes.
4. **Follow the Template**: If one is provided in the repository.

---

## 👑 Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct (TBD). We expect all contributors to maintain a professional, respectful, and inclusive environment.

*Happy Coding! 🐝*
